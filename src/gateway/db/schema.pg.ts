import { pgTable, text, integer, real, boolean, timestamp } from 'drizzle-orm/pg-core';

/**
 * Cloud-side replacement for the local `generations` table (schema.ts) - this is a real job
 * queue, not just a completed-history log. A row's lifecycle is queued -> claimed ->
 * processing -> completed|failed|interrupted, driven entirely by the local worker polling
 * in from the PC (see worker/index.ts) - the cloud never calls out to the PC.
 */
export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(),
  prompt: text('prompt').notNull(),
  encryptedPrompt: text('encrypted_prompt'),
  promptHash: text('prompt_hash').notNull(),
  modelType: text('model_type').notNull(),
  aspectRatio: text('aspect_ratio').notNull().default('1:1'),
  mediaType: text('media_type').notNull().default('image'),
  seed: integer('seed').notNull(),
  steps: integer('steps').notNull().default(20),
  // real, not integer - CFG scale is fractional (e.g. 2.5, 7.5).
  cfg: real('cfg').notNull().default(7),
  samplerName: text('sampler_name').notNull().default('euler'),
  // Blob URL of an uploaded reference image, not a local ComfyUI filename - the worker
  // downloads it from here before re-uploading to its own local ComfyUI instance.
  referenceImageUrl: text('reference_image_url'),
  referenceImageWidth: integer('reference_image_width'),
  referenceImageHeight: integer('reference_image_height'),
  status: text('status').notNull().default('queued'),
  percentage: integer('percentage').notNull().default(0),
  step: integer('step'),
  maxSteps: integer('max_steps'),
  node: text('node'),
  nodeTitle: text('node_title'),
  etaSeconds: integer('eta_seconds'),
  elapsedMs: integer('elapsed_ms'),
  vramCurrentMb: integer('vram_current_mb'),
  vramPeakMb: integer('vram_peak_mb'),
  mediaUrl: text('media_url'),
  durationMs: integer('duration_ms').notNull().default(0),
  error: text('error'),
  // Set by POST /api/jobs/:id/interrupt; the worker checks this on its next progress-report
  // round trip (it cannot be pushed to - it only ever polls out) and interrupts ComfyUI locally.
  interruptRequested: boolean('interrupt_requested').notNull().default(false),
  metadataJson: text('metadata_json'),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp('claimed_at', { mode: 'string', withTimezone: true }),
  completedAt: timestamp('completed_at', { mode: 'string', withTimezone: true }),
});

/**
 * Single-row-per-worker heartbeat, replacing the old live `nvidia-smi` shell-out
 * (vramMonitor.ts) for the cloud side, which has no way to reach the PC directly. The worker
 * posts real telemetry here every few seconds; the cloud derives "PC online" purely from
 * how stale lastSeenAt is (see requireFreshHeartbeat in db/store.pg.ts) - never faked.
 */
export const workerHeartbeat = pgTable('worker_heartbeat', {
  id: text('id').primaryKey(),
  lastSeenAt: timestamp('last_seen_at', { mode: 'string', withTimezone: true }).notNull(),
  device: text('device'),
  vramUsedMb: integer('vram_used_mb'),
  vramTotalMb: integer('vram_total_mb'),
  vramFreeMb: integer('vram_free_mb'),
  systemRamUsedMb: integer('system_ram_used_mb'),
  systemRamTotalMb: integer('system_ram_total_mb'),
  comfyOnline: boolean('comfy_online').notNull().default(false),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type WorkerHeartbeatRow = typeof workerHeartbeat.$inferSelect;
