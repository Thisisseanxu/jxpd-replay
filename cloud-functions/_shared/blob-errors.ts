import {
  PagesBlobError,
  QuotaExceededError,
} from '@edgeone/pages-blob';

const CAPACITY_MESSAGE =
  /storage quota exceeded|quota.{0,32}(?:exceeded|exhausted|limit)|capacity.{0,32}(?:exceeded|full)|insufficient storage|存储.{0,16}(?:容量|配额).{0,16}(?:不足|已满|超限)/i;

/**
 * The current Pages Blob SDK can report a full store either as the public
 * QuotaExceededError or as a credential/COS error whose message carries the
 * actual quota failure. Keep the fallback narrow so unrelated Blob outages
 * retain the generic server-error response.
 */
export function isBlobCapacityError(error: unknown) {
  if (error instanceof QuotaExceededError) return true;
  if (!error || typeof error !== 'object') return false;

  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === 'QUOTA_EXCEEDED') return true;
  if (
    !(error instanceof PagesBlobError) &&
    candidate.code !== 'CREDENTIAL_ERROR' &&
    candidate.code !== 'COS_ERROR'
  ) {
    return false;
  }
  return (
    typeof candidate.message === 'string' &&
    CAPACITY_MESSAGE.test(candidate.message)
  );
}
