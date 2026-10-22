import crypto from 'node:crypto';
import { AppError } from './http.js';

function key() {
  const source = process.env.CARRIER_ENCRYPTION_KEY;
  if (!source || source.length < 32) throw new AppError(503, 'carrier_key_missing', 'Шифрование ключей доставки не настроено на сервере');
  return Buffer.from(crypto.hkdfSync('sha256', source, 'shmotki-carrier-secrets', 'v1', 32));
}

export function encryptCarrierSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptCarrierSecret(value: string) {
  try {
    const [version, iv, tag, encrypted] = value.split(':');
    if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('invalid secret');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new AppError(503, 'carrier_secret_unavailable', 'Ключи доставки недоступны. Переподключите службу в настройках магазина.');
  }
}
