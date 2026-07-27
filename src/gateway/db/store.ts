import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, desc, like, or } from 'drizzle-orm';
import { generations, GenerationRecord } from './schema.js';
import { GatewaySettings } from '../types.js';

const DATA_DIR = path.join(process.cwd(), '.data');
const LEGACY_GENERATIONS_FILE = path.join(DATA_DIR, 'generations.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SQLITE_FILE = path.join(DATA_DIR, 'gateway.sqlite3');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const sqlite = new Database(SQLITE_FILE);
sqlite.pragma('journal_mode = WAL');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    encrypted_prompt TEXT,
    prompt_hash TEXT NOT NULL,
    model_type TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL DEFAULT '1:1',
    media_type TEXT NOT NULL DEFAULT 'image',
    media_url TEXT NOT NULL,
    encrypted_media_url TEXT,
    local_file_path TEXT NOT NULL,
    seed INTEGER NOT NULL,
    steps INTEGER NOT NULL DEFAULT 20,
    cfg REAL NOT NULL DEFAULT 7,
    sampler_name TEXT NOT NULL DEFAULT 'euler',
    vram_peak_mb INTEGER,
    duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL,
    metadata_json TEXT
  );
`);

export const db = drizzle(sqlite, { schema: { generations } });

/**
 * One-time migration: if a legacy JSON-file store exists from before this app used real
 * SQLite, and the SQLite table is still empty, import those records so nothing is lost.
 */
function migrateLegacyJsonStore() {
  if (!fs.existsSync(LEGACY_GENERATIONS_FILE)) return;

  const rowCount = sqlite.prepare('SELECT COUNT(*) as count FROM generations').get() as { count: number };
  if (rowCount.count > 0) return;

  try {
    const content = fs.readFileSync(LEGACY_GENERATIONS_FILE, 'utf8').trim();
    const legacyRecords: GenerationRecord[] = content ? JSON.parse(content) : [];
    if (legacyRecords.length === 0) return;

    const insertMany = sqlite.transaction((records: GenerationRecord[]) => {
      for (const r of records) {
        db.insert(generations).values(r).run();
      }
    });
    insertMany(legacyRecords);
    console.log(`[Store] Migrated ${legacyRecords.length} legacy JSON generation record(s) into SQLite.`);
  } catch (err) {
    console.error('[Store] Failed to migrate legacy generations.json into SQLite:', err);
  }
}

migrateLegacyJsonStore();

let currentSettings: GatewaySettings = {
  comfyUrl: process.env.COMFYUI_URL || 'http://127.0.0.1:8188',
  authToken: process.env.GATEWAY_AUTH_TOKEN || 'sec_rtx3060ti_gateway_key_9988',
  encryptionSecret: process.env.ENCRYPTION_SECRET || 'master_encrypted_key_rtx3060ti_2026',
  autoOomCheck: true,
  vramThresholdMb: 2000,
};

function persistSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(currentSettings, null, 2), 'utf8');
  } catch (err) {
    console.error('[Store] Error persisting settings:', err);
  }
}

function initSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const settingsContent = fs.readFileSync(SETTINGS_FILE, 'utf8').trim();
      if (settingsContent) {
        const parsed = JSON.parse(settingsContent);
        delete parsed.isSimulatedMode; // retired - was force-disabled everywhere, never functional
        currentSettings = { ...currentSettings, ...parsed };
      }
    } else {
      persistSettings();
    }
  } catch (err) {
    console.error('[Store] Error reading settings, using defaults:', err);
  }
}

initSettings();

export function clearAllGenerations() {
  db.delete(generations).run();
}

export function getGenerations(limit: number = 50): GenerationRecord[] {
  return db.select().from(generations).orderBy(desc(generations.createdAt)).limit(limit).all();
}

export function getGenerationById(id: string): GenerationRecord | undefined {
  return db.select().from(generations).where(eq(generations.id, id)).get();
}

export function saveGeneration(record: GenerationRecord): GenerationRecord {
  const existing = db.select({ id: generations.id }).from(generations).where(eq(generations.id, record.id)).get();

  if (existing) {
    db.update(generations).set(record).where(eq(generations.id, record.id)).run();
  } else {
    db.insert(generations).values(record).run();
  }

  return record;
}

export function updateGenerationStatus(
  id: string,
  status: GenerationRecord['status'],
  mediaUrl?: string,
  vramUsedMb?: number
) {
  const rec = getGenerationById(id);
  if (!rec) return;

  db.update(generations)
    .set({
      status,
      ...(mediaUrl && { mediaUrl }),
      ...(vramUsedMb && vramUsedMb > (rec.vramPeakMb || 0) && { vramPeakMb: vramUsedMb }),
    })
    .where(eq(generations.id, id))
    .run();
}

export function getSettings(): GatewaySettings {
  return { ...currentSettings };
}

export function updateSettings(newSettings: Partial<GatewaySettings>): GatewaySettings {
  currentSettings = { ...currentSettings, ...newSettings };
  persistSettings();
  return currentSettings;
}

export function queryGenerations(query: string): GenerationRecord[] {
  const pattern = `%${query}%`;
  return db
    .select()
    .from(generations)
    .where(
      or(
        like(generations.prompt, pattern),
        like(generations.modelType, pattern),
        like(generations.promptHash, pattern)
      )
    )
    .orderBy(desc(generations.createdAt))
    .all();
}

export const querySecondBrainIndex = queryGenerations;
