import crypto from 'crypto';
import { EncryptedDataPayload } from '../types.js';

// Default secret if process.env is not configured
const DEFAULT_SECRET = process.env.ENCRYPTION_SECRET || 'rtx3060ti_secure_master_key_2026_aes256';

/**
 * Derives a 32-byte Key from a secret string using SHA-256
 */
function deriveKey(secret: string = DEFAULT_SECRET): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Computes a SHA-256 cryptographic hash of string data
 */
export function hashData(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Encrypts arbitrary text or media paths using AES-256-GCM
 */
export function encryptData(text: string, customSecret?: string): EncryptedDataPayload {
  const key = deriveKey(customSecret);
  const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let ciphertext = cipher.update(text, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  const hash = hashData(text);

  return {
    ciphertext,
    iv: iv.toString('hex'),
    authTag,
    hash,
  };
}

/**
 * Decrypts AES-256-GCM encrypted payload back into original string
 */
export function decryptData(payload: EncryptedDataPayload, customSecret?: string): string {
  try {
    const key = deriveKey(customSecret);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'));

    let decrypted = decipher.update(payload.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Decryption failed:', err);
    return '[Decryption Failed / Key Mismatch]';
  }
}

/**
 * Utility to obscure sensitive strings for UI display (e.g., tokens / secrets)
 */
export function maskSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 8) return '••••••••';
  return `${secret.slice(0, 4)}••••••••${secret.slice(-4)}`;
}
