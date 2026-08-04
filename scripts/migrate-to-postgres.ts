// One-time migration: copies completed-job history from the local SQLite vault
// (.data/gateway.sqlite3) into the new Postgres `jobs` table, so real historical averages
// (see getDurationStats) survive the move to the cloud-hosted architecture instead of
// starting from zero. Run locally, once, with DATABASE_URL (or POSTGRES_URL) pointing at the
// Vercel Postgres instance:
//
//   npx tsx scripts/migrate-to-postgres.ts
//
// Media bytes from these old jobs were never uploaded to Vercel Blob (they only ever lived
// on the local ComfyUI instance via /api/view) - mediaUrl is intentionally migrated as null
// rather than carrying over a link that would just 404 in the new deployment. The gallery
// shows these as "No Media" (same honest placeholder MediaGallery.tsx already uses for any
// failed job), while durationMs/vramPeakMb/modelType - the data that actually feeds the ETA
// averages - comes across intact.
import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { db } from '../src/gateway/db/store.pg.js';
import { jobs } from '../src/gateway/db/schema.pg.js';

const SQLITE_FILE = path.join(process.cwd(), '.data', 'gateway.sqlite3');

interface LegacyRow {
  id: string;
  prompt: string;
  encrypted_prompt: string | null;
  prompt_hash: string;
  model_type: string;
  aspect_ratio: string;
  media_type: string;
  seed: number;
  steps: number;
  cfg: number;
  sampler_name: string;
  vram_peak_mb: number | null;
  duration_ms: number;
  status: string;
  created_at: string;
  metadata_json: string | null;
}

async function main() {
  if (!fs.existsSync(SQLITE_FILE)) {
    console.log(`No local SQLite vault found at ${SQLITE_FILE} - nothing to migrate.`);
    return;
  }

  const sqlite = new Database(SQLITE_FILE, { readonly: true });
  const rows = sqlite.prepare('SELECT * FROM generations ORDER BY created_at ASC').all() as LegacyRow[];
  sqlite.close();

  if (rows.length === 0) {
    console.log('Local SQLite vault has no rows - nothing to migrate.');
    return;
  }

  console.log(`Found ${rows.length} local record(s). Migrating to Postgres...`);

  let migrated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      await db
        .insert(jobs)
        .values({
          id: row.id,
          prompt: row.prompt,
          encryptedPrompt: row.encrypted_prompt,
          promptHash: row.prompt_hash,
          modelType: row.model_type,
          aspectRatio: row.aspect_ratio,
          mediaType: row.media_type,
          seed: row.seed,
          steps: row.steps,
          cfg: row.cfg,
          samplerName: row.sampler_name,
          status: row.status,
          percentage: row.status === 'completed' ? 100 : 0,
          vramPeakMb: row.vram_peak_mb,
          mediaUrl: null,
          durationMs: row.duration_ms,
          metadataJson: row.metadata_json,
          createdAt: row.created_at,
        })
        .onConflictDoNothing();
      migrated++;
    } catch (err) {
      console.error(`Failed to migrate record ${row.id}:`, err);
      skipped++;
    }
  }

  console.log(`Done. Migrated ${migrated} record(s), skipped ${skipped}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
