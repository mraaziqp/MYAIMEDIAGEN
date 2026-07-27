import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const generations = sqliteTable('generations', {
  id: text('id').primaryKey(),
  prompt: text('prompt').notNull(),
  encryptedPrompt: text('encrypted_prompt'),
  promptHash: text('prompt_hash').notNull(),
  modelType: text('model_type').notNull(), // 'image_fast' | 'image_hd' | 'video_short'
  aspectRatio: text('aspect_ratio').notNull().default('1:1'),
  mediaType: text('media_type').notNull().default('image'),
  mediaUrl: text('media_url').notNull(),
  encryptedMediaUrl: text('encrypted_media_url'),
  localFilePath: text('local_file_path').notNull(),
  seed: integer('seed').notNull(),
  steps: integer('steps').notNull().default(20),
  // real, not integer - CFG scale is fractional (e.g. 2.5, 7.5); integer would silently truncate it.
  cfg: real('cfg').notNull().default(7),
  samplerName: text('sampler_name').notNull().default('euler'),
  vramPeakMb: integer('vram_peak_mb'),
  durationMs: integer('duration_ms').notNull(),
  status: text('status').notNull().default('completed'),
  createdAt: text('created_at').notNull(),
  metadataJson: text('metadata_json'),
});

export type GenerationRecord = typeof generations.$inferSelect;
export type NewGenerationRecord = typeof generations.$inferInsert;
