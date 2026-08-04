import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { eq, desc, sql, or, like } from 'drizzle-orm';
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
const HEARTBEAT_STALE_MS = 15_000;

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

export async function queryJobs(query: string): Promise<Job[]> {
  await ensureSchema();
  const pattern = `%${query}%`;
  return db
    .select()
    .from(jobs)
    .where(or(like(jobs.prompt, pattern), like(jobs.modelType, pattern), like(jobs.promptHash, pattern)))
    .orderBy(desc(jobs.createdAt));
}

/**
 * Atomically claims the oldest still-queued job for the worker that's polling
 * GET /api/worker/next-job. FOR UPDATE SKIP LOCKED in the subquery plus the outer `status =
 * 'queued'` guard means two concurrent claimers can never both walk away with the same row -
 * only matters if more than one worker is ever running, but it's the correct pattern either way.
 */
export async function claimNextJob(): Promise<Job | null> {
  await ensureSchema();
  const claimed = await db
    .update(jobs)
    .set({ status: 'claimed', claimedAt: new Date().toISOString() })
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
  await db.update(jobs).set(patch).where(eq(jobs.id, id));
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
      mediaUrl: data.mediaUrl,
      durationMs: data.durationMs,
      vramPeakMb: data.vramPeakMb,
      completedAt: new Date().toISOString(),
    })
    .where(eq(jobs.id, id));
}

export async function failJob(
  id: string,
  data: { error: string; status: 'failed' | 'interrupted' }
): Promise<void> {
  await ensureSchema();
  await db
    .update(jobs)
    .set({ status: data.status, error: data.error, completedAt: new Date().toISOString() })
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

export async function getDurationStats(): Promise<DurationStat[]> {
  await ensureSchema();
  const stats: DurationStat[] = [];
  for (const modelType of KNOWN_MODEL_TYPES) {
    const rows = await db
      .select({ durationMs: jobs.durationMs })
      .from(jobs)
      .where(sql`${jobs.modelType} = ${modelType} AND ${jobs.durationMs} > 0`)
      .orderBy(desc(jobs.createdAt))
      .limit(DURATION_SAMPLE_SIZE);

    if (rows.length === 0) {
      stats.push({ modelType, avgDurationMs: null, sampleCount: 0 });
      continue;
    }

    const avgDurationMs = Math.round(rows.reduce((sum, r) => sum + r.durationMs, 0) / rows.length);
    stats.push({ modelType, avgDurationMs, sampleCount: rows.length });
  }
  return stats;
}

export async function upsertHeartbeat(data: {
  device?: string;
  vramUsedMb?: number;
  vramTotalMb?: number;
  vramFreeMb?: number;
  systemRamUsedMb?: number;
  systemRamTotalMb?: number;
  comfyOnline: boolean;
}): Promise<void> {
  await ensureSchema();
  await db
    .insert(workerHeartbeat)
    .values({ id: HEARTBEAT_ROW_ID, lastSeenAt: new Date().toISOString(), ...data })
    .onConflictDoUpdate({
      target: workerHeartbeat.id,
      set: { lastSeenAt: new Date().toISOString(), ...data },
    });
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
