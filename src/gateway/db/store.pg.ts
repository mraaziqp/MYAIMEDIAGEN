import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, desc, sql, or, ilike } from 'drizzle-orm';
import { jobs, workerHeartbeat, Job, NewJob, WorkerHeartbeatRow } from './schema.pg.js';

// Neon's Vercel Marketplace integration injects DATABASE_URL; POSTGRES_URL is kept as a
// fallback since that's the name the older native "Vercel Postgres" integration used and
// some setups still carry it forward.
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL (or POSTGRES_URL) is not set - connect the Postgres integration to this Vercel project first.'
  );
}

const sqlClient = neon(connectionString);
export const db = drizzle(sqlClient, { schema: { jobs, workerHeartbeat } });

// A heartbeat older than this is treated as the worker/PC being offline - never assumed
// online just because a row exists in the table.
/**
 * Grace before the PC is declared offline. This must be several heartbeat intervals, not one
 * or two: at 15s against a ~7s heartbeat the margin was under a single beat, so one slow
 * Vercel/Neon cold start was enough to report a healthy worker as offline - the "randomly goes
 * offline" flicker. At 30s against the worker's fixed 5s cadence, six consecutive heartbeats
 * must be lost before the dashboard changes its mind, while a genuinely dead worker is still
 * caught within half a minute.
 */
const HEARTBEAT_STALE_MS = 30_000;

const HEARTBEAT_ROW_ID = 'default';

// Same idea as db/store.ts's `CREATE TABLE IF NOT EXISTS` at module load for the local
// SQLite vault - this codebase has no drizzle-kit migration step, so schema creation is just
// plain idempotent DDL run once per cold start. Memoized so warm serverless invocations
// (module stays cached between calls) don't re-issue it on every request.
let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sqlClient`
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          prompt TEXT NOT NULL,
          encrypted_prompt TEXT,
          prompt_hash TEXT NOT NULL,
          model_type TEXT NOT NULL,
          aspect_ratio TEXT NOT NULL DEFAULT '1:1',
          media_type TEXT NOT NULL DEFAULT 'image',
          seed INTEGER NOT NULL,
          steps INTEGER NOT NULL DEFAULT 20,
          cfg REAL NOT NULL DEFAULT 7,
          sampler_name TEXT NOT NULL DEFAULT 'euler',
          reference_image_url TEXT,
          reference_image_width INTEGER,
          reference_image_height INTEGER,
          status TEXT NOT NULL DEFAULT 'queued',
          percentage INTEGER NOT NULL DEFAULT 0,
          phase TEXT,
          step INTEGER,
          max_steps INTEGER,
          node TEXT,
          node_title TEXT,
          eta_seconds INTEGER,
          elapsed_ms INTEGER,
          vram_current_mb INTEGER,
          vram_peak_mb INTEGER,
          media_url TEXT,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          interrupt_requested BOOLEAN NOT NULL DEFAULT false,
          metadata_json TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          claimed_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ
        );
      `;
      // CREATE TABLE IF NOT EXISTS is a no-op against a table that already exists, so columns
      // added after the first deploy need their own idempotent ALTER - without this, an
      // existing `jobs` table would never gain `phase` and every write naming it would fail.
      await sqlClient`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS phase TEXT;`;
      await sqlClient`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;`;
      await sqlClient`
        ALTER TABLE worker_heartbeat
          ADD COLUMN IF NOT EXISTS reclaimable_vram_mb INTEGER,
          ADD COLUMN IF NOT EXISTS free_vram_requested_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS free_vram_handled_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS free_vram_reclaimed_mb INTEGER;
      `;
      await sqlClient`CREATE INDEX IF NOT EXISTS jobs_status_created_at_idx ON jobs (status, created_at);`;
      await sqlClient`
        CREATE TABLE IF NOT EXISTS worker_heartbeat (
          id TEXT PRIMARY KEY,
          last_seen_at TIMESTAMPTZ NOT NULL,
          device TEXT,
          vram_used_mb INTEGER,
          vram_total_mb INTEGER,
          vram_free_mb INTEGER,
          system_ram_used_mb INTEGER,
          system_ram_total_mb INTEGER,
          comfy_online BOOLEAN NOT NULL DEFAULT false
        );
      `;
    })();
  }
  return schemaReady;
}

export async function createJob(job: NewJob): Promise<Job> {
  await ensureSchema();
  const [row] = await db.insert(jobs).values(job).returning();
  return row;
}

export async function getJobs(limit = 50): Promise<Job[]> {
  await ensureSchema();
  return db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit);
}

export async function getJobById(id: string): Promise<Job | undefined> {
  await ensureSchema();
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row;
}

/**
 * Gallery search. Two fixes over the original: it was unbounded, so a broad term (or an empty
 * -ish one) returned every matching row in the vault and shipped all of it to the browser; and
 * it used LIKE, which is case-sensitive in Postgres, so "Cyberpunk" silently missed a prompt
 * written "cyberpunk". Bounded with the same default the non-search path already uses.
 */
export async function queryJobs(query: string, limit = 50): Promise<Job[]> {
  await ensureSchema();
  const pattern = `%${query}%`;
  return db
    .select()
    .from(jobs)
    .where(or(ilike(jobs.prompt, pattern), ilike(jobs.modelType, pattern), ilike(jobs.promptHash, pattern)))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
}

/**
 * Atomically claims the oldest still-queued job for the worker that's polling
 * GET /api/worker/next-job. FOR UPDATE SKIP LOCKED in the subquery plus the outer `status =
 * 'queued'` guard means two concurrent claimers can never both walk away with the same row -
 * only matters if more than one worker is ever running, but it's the correct pattern either way.
 */
/**
 * A worker that dies mid-render leaves its job stuck in claimed/processing forever: claimNextJob
 * only ever picks up 'queued' rows, so nothing can adopt it, and the dashboard polls a job that
 * will never move again. This releases those back to the queue so the render actually happens.
 *
 * The window is deliberately far longer than any legitimate render. runJob's own absolute
 * ceiling is 45 minutes, so anything claimed over an hour ago without reaching a terminal state
 * cannot still be running - which means this can never steal a job from a live worker.
 */
const ORPHAN_RECLAIM_AFTER = '60 minutes';

export interface ActiveJobSummary {
  id: string;
  modelType: string;
  status: string;
  phase: string | null;
  percentage: number;
  etaSeconds: number | null;
  elapsedMs: number | null;
  queuedBehind: number;
}

/**
 * The single in-flight render, plus how many are waiting behind it.
 *
 * "A render is running" previously existed only as activePromptId in one browser's
 * localStorage, so it was invisible from any other device - open the dashboard on a phone
 * mid-render and it looked idle. Since the worker processes strictly one job at a time, this is
 * authoritative for the whole system rather than per-client, which is what makes it safe to gate
 * destructive actions (like a VRAM purge) on.
 */
export async function getActiveJob(): Promise<ActiveJobSummary | null> {
  await ensureSchema();
  const [row] = await db
    .select()
    .from(jobs)
    .where(sql`${jobs.status} IN ('claimed', 'processing')`)
    .orderBy(desc(jobs.claimedAt))
    .limit(1);
  if (!row) return null;

  const [pending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(eq(jobs.status, 'queued'));

  return {
    id: row.id,
    modelType: row.modelType,
    status: row.status,
    phase: row.phase,
    percentage: row.percentage,
    etaSeconds: row.etaSeconds,
    elapsedMs: row.elapsedMs,
    queuedBehind: pending?.count ?? 0,
  };
}

export async function requeueOrphanedJobs(): Promise<number> {
  await ensureSchema();
  const released = await db
    .update(jobs)
    .set({ status: 'queued', phase: null, percentage: 0, claimedAt: null, nodeTitle: 'Requeued after worker restart' })
    .where(
      sql`${jobs.status} IN ('claimed', 'processing')
          AND ${jobs.claimedAt} IS NOT NULL
          AND ${jobs.claimedAt} < now() - interval '${sql.raw(ORPHAN_RECLAIM_AFTER)}'`
    )
    .returning({ id: jobs.id });
  return released.length;
}

export async function claimNextJob(): Promise<Job | null> {
  await ensureSchema();
  // Self-healing: run before every claim so a stuck job is recovered without operator action.
  await requeueOrphanedJobs();
  const claimed = await db
    .update(jobs)
    // attempts increments on claim, not on failure, so a worker that dies without reporting
    // anything still consumes its budget - otherwise a job that reliably kills the worker would
    // be retried forever.
    .set({ status: 'claimed', claimedAt: new Date().toISOString(), attempts: sql`${jobs.attempts} + 1` })
    .where(
      sql`${jobs.id} = (
        SELECT id FROM ${jobs}
        WHERE ${jobs.status} = 'queued'
        ORDER BY ${jobs.createdAt} ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ) AND ${jobs.status} = 'queued'`
    )
    .returning();
  return claimed[0] ?? null;
}

export async function updateJobProgress(
  id: string,
  patch: Partial<
    Pick<
      Job,
      | 'status'
      | 'percentage'
      | 'phase'
      | 'step'
      | 'maxSteps'
      | 'node'
      | 'nodeTitle'
      | 'etaSeconds'
      | 'elapsedMs'
      | 'vramCurrentMb'
    >
  >
): Promise<void> {
  await ensureSchema();
  // Never resurrect a finished job. The worker's progress ticker and its terminal
  // complete/fail call are separate round trips, so a tick already in flight can land after
  // the job is done - without this guard that late write would overwrite the final row and
  // set status back to 'processing', leaving a completed render stuck showing as running.
  await db
    .update(jobs)
    .set(patch)
    .where(sql`${jobs.id} = ${id} AND ${jobs.status} NOT IN ('completed', 'failed', 'interrupted')`);
}

export async function completeJob(
  id: string,
  data: { mediaUrl: string; durationMs: number; vramPeakMb?: number }
): Promise<void> {
  await ensureSchema();
  await db
    .update(jobs)
    .set({
      status: 'completed',
      percentage: 100,
      phase: 'done',
      // Overwrite the last in-flight label. Without this a finished row keeps whatever the
      // final tick wrote ("Saving image - 232s elapsed"), which then reads as the permanent
      // description of the job everywhere it's listed, including the gallery.
      nodeTitle: `Completed in ${(data.durationMs / 1000).toFixed(1)}s`,
      etaSeconds: 0,
      elapsedMs: data.durationMs,
      mediaUrl: data.mediaUrl,
      durationMs: data.durationMs,
      vramPeakMb: data.vramPeakMb,
      completedAt: new Date().toISOString(),
    })
    .where(eq(jobs.id, id));
}

/**
 * Maximum dispatches per job. 3 covers the realistic transient cases - ComfyUI restarting, a
 * dropped socket, a blob hiccup - while still converging quickly if the cause is persistent.
 */
export const MAX_JOB_ATTEMPTS = 3;

/**
 * Returns a job to the queue after a TRANSIENT failure so it is retried automatically, or fails
 * it permanently once the attempt budget is spent.
 *
 * Only the worker decides what is transient (see runJob's classifier) - a missing checkpoint or
 * an OOM guardrail must never be retried, since repeating them just burns the GPU to reach the
 * same conclusion. This exists because every failure used to be terminal: a ComfyUI restart
 * mid-render permanently killed the job, which is precisely the kind of thing that should heal
 * itself without the user noticing.
 */
export async function retryOrFailJob(
  id: string,
  error: string
): Promise<{ retried: boolean; attempts: number }> {
  await ensureSchema();
  const [row] = await db.select({ attempts: jobs.attempts }).from(jobs).where(eq(jobs.id, id)).limit(1);
  const attempts = row?.attempts ?? 0;

  if (attempts >= MAX_JOB_ATTEMPTS) {
    await failJob(id, { error: `${error} (gave up after ${attempts} attempts)`, status: 'failed' });
    return { retried: false, attempts };
  }

  await db
    .update(jobs)
    .set({
      status: 'queued',
      phase: null,
      percentage: 0,
      step: null,
      maxSteps: null,
      etaSeconds: null,
      elapsedMs: null,
      claimedAt: null,
      error: null,
      nodeTitle: `Retrying after: ${error.slice(0, 120)}`,
    })
    .where(eq(jobs.id, id));
  return { retried: true, attempts };
}

export async function failJob(
  id: string,
  data: { error: string; status: 'failed' | 'interrupted' }
): Promise<void> {
  await ensureSchema();
  await db
    .update(jobs)
    .set({
      status: data.status,
      phase: data.status === 'interrupted' ? 'interrupted' : 'failed',
      nodeTitle: data.status === 'interrupted' ? 'Halted by user' : 'Failed',
      etaSeconds: null,
      error: data.error,
      completedAt: new Date().toISOString(),
    })
    .where(eq(jobs.id, id));
}

/**
 * Flags a job for interruption. The worker can only be polled, never pushed to, so this just
 * sets a flag it will see on its next progress round trip (see /api/worker/progress's
 * response body) rather than doing anything to ComfyUI directly from the cloud.
 */
export async function requestInterrupt(id: string): Promise<void> {
  await ensureSchema();
  await db.update(jobs).set({ interruptRequested: true }).where(eq(jobs.id, id));
}

export interface DurationStat {
  modelType: string;
  avgDurationMs: number | null;
  sampleCount: number;
}

const DURATION_SAMPLE_SIZE = 20;
const KNOWN_MODEL_TYPES = ['image_fast', 'image_hd', 'video_short'];

/**
 * One round trip for all model types instead of a query per type inside a loop. Each of those
 * was a separate network hop to Neon, so the endpoint's latency scaled with the number of
 * models - and this runs on every dashboard load and after every completed render.
 *
 * The window function reproduces the per-model "last N" limit that the per-type LIMIT gave:
 * rank rows within each model_type by recency, keep the newest DURATION_SAMPLE_SIZE, then
 * average. Models with no completed runs are still reported with a null average rather than
 * omitted, so the UI can distinguish "no data yet" from "zero".
 */
export async function getDurationStats(): Promise<DurationStat[]> {
  await ensureSchema();
  const rows = (await sqlClient`
    SELECT model_type, ROUND(AVG(duration_ms))::int AS avg_duration_ms, COUNT(*)::int AS sample_count
    FROM (
      SELECT model_type, duration_ms,
             ROW_NUMBER() OVER (PARTITION BY model_type ORDER BY created_at DESC) AS rn
      FROM jobs
      WHERE duration_ms > 0 AND status = 'completed'
    ) ranked
    WHERE rn <= ${DURATION_SAMPLE_SIZE}
    GROUP BY model_type
  `) as Array<{ model_type: string; avg_duration_ms: number; sample_count: number }>;

  const byModel = new Map(rows.map((r) => [r.model_type, r]));
  return KNOWN_MODEL_TYPES.map((modelType) => {
    const hit = byModel.get(modelType);
    return {
      modelType,
      avgDurationMs: hit ? hit.avg_duration_ms : null,
      sampleCount: hit ? hit.sample_count : 0,
    };
  });
}

/**
 * Mean wall-clock duration of the last few completed runs of one model, or null if that model
 * has never completed here. Handed to the worker with the job it claims (see
 * api/worker/next-job.ts) so it can report a real ETA during the model-load phase, where
 * ComfyUI gives no step counter to extrapolate from. Null is meaningful and must be preserved
 * rather than defaulted: with no history the worker reports elapsed only and no ETA at all,
 * instead of inventing a number.
 */
export async function getAvgDurationMs(modelType: string): Promise<number | null> {
  await ensureSchema();
  const rows = await db
    .select({ durationMs: jobs.durationMs })
    .from(jobs)
    .where(sql`${jobs.modelType} = ${modelType} AND ${jobs.status} = 'completed' AND ${jobs.durationMs} > 0`)
    .orderBy(desc(jobs.createdAt))
    .limit(DURATION_SAMPLE_SIZE);

  if (rows.length === 0) return null;
  return Math.round(rows.reduce((sum, r) => sum + r.durationMs, 0) / rows.length);
}

/**
 * How many jobs are ahead of this one in the queue. The worker claims strictly oldest-first
 * (claimNextJob), so "queued and older than me" is exactly the wait, letting the dashboard say
 * "2 ahead" instead of an indefinite "waiting for your PC".
 */
export async function getQueuePosition(id: string): Promise<number> {
  await ensureSchema();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(sql`${jobs.status} = 'queued' AND ${jobs.createdAt} < (SELECT created_at FROM jobs WHERE id = ${id})`);
  return row?.count ?? 0;
}

export async function upsertHeartbeat(data: {
  device?: string;
  vramUsedMb?: number;
  vramTotalMb?: number;
  vramFreeMb?: number;
  systemRamUsedMb?: number;
  systemRamTotalMb?: number;
  comfyOnline: boolean;
  // Nullable, not merely optional: drizzle skips undefined keys, so leaving it out preserved the
  // previous value. When ComfyUI goes down the last figure it reported is no longer true - and a
  // stale one had the dashboard offering "RECLAIM 7.8 GB" against a ComfyUI that wasn't running
  // and could not free a byte. Writing null actively clears it.
  reclaimableVramMb?: number | null;
}): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  await db
    .insert(workerHeartbeat)
    .values({ id: HEARTBEAT_ROW_ID, lastSeenAt: now, ...data })
    .onConflictDoUpdate({
      target: workerHeartbeat.id,
      set: { lastSeenAt: now, ...data },
    });
}

/**
 * Flags that the user wants ComfyUI's held VRAM released. Refused while a job is actually
 * running: unloading models mid-render would destroy the in-flight generation, and the legacy
 * local server refused the same case for the same reason.
 */
export async function requestFreeVram(): Promise<{ accepted: boolean; reason?: string }> {
  await ensureSchema();
  const [active] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(sql`${jobs.status} IN ('claimed', 'processing')`)
    .limit(1);
  if (active) {
    return { accepted: false, reason: 'A render is currently running - reclaiming VRAM now would kill it.' };
  }

  // Only ComfyUI can release this memory, so a request it cannot possibly satisfy is refused
  // rather than accepted. Previously the flag was set regardless, the worker's /free call failed
  // silently against an unreachable ComfyUI, the request was marked handled, and the dashboard
  // reported "purge signal sent" while nothing changed - so the button looked like it kept
  // failing with no explanation.
  const { online, heartbeat } = await getHeartbeatStatus();
  if (!online) {
    return { accepted: false, reason: 'Your PC is offline - there is nothing running to reclaim VRAM from.' };
  }
  if (!heartbeat?.comfyOnline) {
    return {
      accepted: false,
      reason: 'ComfyUI is not reachable on your PC, so it cannot release any VRAM. Start ComfyUI and try again.',
    };
  }

  const now = new Date().toISOString();
  await db
    .insert(workerHeartbeat)
    .values({ id: HEARTBEAT_ROW_ID, freeVramRequestedAt: now, comfyOnline: false, lastSeenAt: now })
    .onConflictDoUpdate({
      target: workerHeartbeat.id,
      set: { freeVramRequestedAt: now },
    });
  return { accepted: true };
}

/** Records that the worker carried out a reclaim, and how much it actually got back. */
export async function markFreeVramHandled(reclaimedMb: number): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  await db
    .insert(workerHeartbeat)
    .values({ id: HEARTBEAT_ROW_ID, freeVramHandledAt: now, freeVramReclaimedMb: reclaimedMb, comfyOnline: false, lastSeenAt: now })
    .onConflictDoUpdate({
      target: workerHeartbeat.id,
      set: { freeVramHandledAt: now, freeVramReclaimedMb: reclaimedMb },
    });
}

/** True when a reclaim has been asked for and not yet carried out. */
export function isFreeVramPending(row: WorkerHeartbeatRow | null): boolean {
  if (!row?.freeVramRequestedAt) return false;
  if (!row.freeVramHandledAt) return true;
  return new Date(row.freeVramRequestedAt).getTime() > new Date(row.freeVramHandledAt).getTime();
}

export interface HeartbeatStatus {
  online: boolean;
  heartbeat: WorkerHeartbeatRow | null;
}

/**
 * Never reports "online" just because a heartbeat row exists - staleness is checked against
 * the real clock every time, matching the app's existing "never fabricate a reading"
 * principle (see vramMonitor.ts's GpuTelemetryError for the same idea on the local gateway).
 */
export async function getHeartbeatStatus(): Promise<HeartbeatStatus> {
  await ensureSchema();
  const [row] = await db.select().from(workerHeartbeat).where(eq(workerHeartbeat.id, HEARTBEAT_ROW_ID)).limit(1);
  if (!row) return { online: false, heartbeat: null };
  const ageMs = Date.now() - new Date(row.lastSeenAt).getTime();
  return { online: ageMs <= HEARTBEAT_STALE_MS, heartbeat: row };
}
