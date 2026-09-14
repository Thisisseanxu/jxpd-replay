import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';

export const SHARE_CODE_LENGTH = 6;
const SHARE_CODE_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SHARE_CODE_PATTERN = new RegExp(
  `^[${SHARE_CODE_ALPHABET}]{${SHARE_CODE_LENGTH}}$`,
);
const UNBIASED_BYTE_LIMIT =
  256 - (256 % SHARE_CODE_ALPHABET.length);

export type ShareCodeRecord = {
  token: string;
  expiresAt: number;
};

export function createShareCode() {
  let code = '';
  while (code.length < SHARE_CODE_LENGTH) {
    for (const byte of randomBytes(SHARE_CODE_LENGTH * 2)) {
      if (byte >= UNBIASED_BYTE_LIMIT) continue;
      code += SHARE_CODE_ALPHABET[byte % SHARE_CODE_ALPHABET.length];
      if (code.length === SHARE_CODE_LENGTH) break;
    }
  }
  return code;
}

export function parseShareCode(value: string) {
  const code = value.trim();
  if (!SHARE_CODE_PATTERN.test(code)) {
    throw new HttpError(400, `分享码应为 ${SHARE_CODE_LENGTH} 位字母或数字`);
  }
  return code;
}

export function shareCodeKey(code: string) {
  const digest = createHash('sha256').update(code).digest('base64url');
  return `share-code/v1/${digest}`;
}

export function isShareCodeRecord(value: unknown): value is ShareCodeRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.token === 'string' &&
    typeof record.expiresAt === 'number' &&
    Number.isSafeInteger(record.expiresAt) &&
    record.expiresAt > 0
  );
}
