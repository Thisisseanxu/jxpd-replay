import { createHash } from 'node:crypto';

export type ReplayRecord = {
  token: string;
  shareCode: string;
  expiresAt: number;
  dataKey: string;
  digest: string;
};

const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{39}$/;
const SHARE_CODE_PATTERN = /^[A-Za-z0-9]{6}$/;
const DATA_KEY_PATTERN =
  /^v1\/exp=\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]{2}\/[A-Za-z0-9_-]{43}$/;

export function replayDigest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('base64url');
}

export function replayDedupKey(digest: string) {
  return `replay-dedup/v1/${digest}`;
}

export function replayCapabilityKey(token: string) {
  const digest = createHash('sha256').update(token).digest('base64url');
  return `replay-capability/v1/${digest}`;
}

export function isReplayRecord(value: unknown): value is ReplayRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.token === 'string' &&
    TOKEN_PATTERN.test(record.token) &&
    typeof record.shareCode === 'string' &&
    SHARE_CODE_PATTERN.test(record.shareCode) &&
    typeof record.expiresAt === 'number' &&
    Number.isSafeInteger(record.expiresAt) &&
    record.expiresAt > 0 &&
    typeof record.dataKey === 'string' &&
    DATA_KEY_PATTERN.test(record.dataKey) &&
    typeof record.digest === 'string' &&
    DIGEST_PATTERN.test(record.digest)
  );
}
