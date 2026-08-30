import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * Application-layer encryption for KYC fields (Aadhaar, etc.) — Section 6/63.
 * Encryption happens here, not at the DB column level, so it survives a
 * DB dump/backup leaking without the app's key. Key comes from
 * KYC_ENCRYPTION_KEY env var; in production this should come from a KMS,
 * not a plain env var — flagged in the README as a Phase 13 hardening item.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    const raw = process.env.KYC_ENCRYPTION_KEY || 'insecure-dev-key-change-me-32b!';
    // Derive a proper 32-byte key regardless of the raw secret's length.
    this.key = createHash('sha256').update(raw).digest();
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Store iv + authTag + ciphertext together, base64-encoded.
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /** e.g. "234567890123" -> "XXXX-XXXX-0123" for default masked display. */
  maskAadhaar(last4: string): string {
    return `XXXX-XXXX-${last4}`;
  }
}
