import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from './http';

const TOKEN_BYTES = 29;

function base64url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url');
}

export function dateKey(timestampSeconds: number) {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

export function createCapability(retentionDays: number) {
  const expiresAt = Math.floor(Date.now() / 1000) + retentionDays * 86_400;
  const bytes = Buffer.alloc(TOKEN_BYTES);
  bytes[0] = 1;
  bytes.writeUInt32BE(expiresAt, 1);
  randomBytes(24).copy(bytes, 5);
  const token = base64url(bytes);
  return { token, expiresAt, key: objectKey(token, expiresAt) };
}

export function parseCapability(token: string) {
  if (!/^[A-Za-z0-9_-]{39}$/.test(token)) {
    throw new HttpError(401, '分享链接无效');
  }
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== TOKEN_BYTES || bytes[0] !== 1) {
    throw new HttpError(401, '分享链接无效');
  }
  const expiresAt = bytes.readUInt32BE(1);
  return { token, expiresAt, key: objectKey(token, expiresAt) };
}

export function objectKey(token: string, expiresAt: number) {
  const id = createHash('sha256').update(token).digest('base64url');
  return `v1/exp=${dateKey(expiresAt)}/${id.slice(0, 2)}/${id}`;
}
