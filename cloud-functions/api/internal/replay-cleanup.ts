import {
  getStore,
  PreconditionFailedError,
  type Store,
} from '@edgeone/pages-blob';
import { CONTROL_STORE_NAME, DATA_STORE_NAME } from '../../_shared/constants.js';
import type { FunctionContext } from '../../_shared/constants.js';
import { errorResponse, jsonResponse } from '../../_shared/http.js';
import { shanghaiDay } from '../../_shared/identity.js';
import { isReplayRecord, replayDedupKey } from '../../_shared/replay-record.js';
import { isShareCodeRecord, shareCodeKey } from '../../_shared/share-code.js';

const MAX_DELETES_PER_RUN = 2_000;
const DELETE_BATCH_SIZE = 20;

async function deletePrefix(
  store: Store,
  prefix: string,
  budget: { remaining: number },
) {
  let deleted = 0;
  while (budget.remaining > 0) {
    const { blobs } = await store.list({
      prefix,
      limit: Math.min(200, budget.remaining),
      paginate: false,
      consistency: 'strong',
    });
    if (!blobs.length) break;
    for (let index = 0; index < blobs.length; index += DELETE_BATCH_SIZE) {
      const batch = blobs.slice(index, index + DELETE_BATCH_SIZE);
      await Promise.all(batch.map((blob) => store.delete(blob.key)));
      deleted += batch.length;
      budget.remaining -= batch.length;
      if (budget.remaining <= 0) break;
    }
  }
  return deleted;
}

async function deleteExpiredLocks(
  store: Store,
  today: string,
  budget: { remaining: number },
) {
  if (budget.remaining <= 0) return 0;
  const { blobs } = await store.list({
    prefix: 'cleanup-lock/',
    consistency: 'strong',
  });
  const expiredKeys = blobs
    .map((blob) => blob.key)
    .filter((key) => {
      const match = /^cleanup-lock\/(\d{4}-\d{2}-\d{2})$/.exec(key);
      return Boolean(match && match[1] < today);
    })
    .sort()
    .slice(0, budget.remaining);

  for (let index = 0; index < expiredKeys.length; index += DELETE_BATCH_SIZE) {
    const batch = expiredKeys.slice(index, index + DELETE_BATCH_SIZE);
    await Promise.all(batch.map((key) => store.delete(key)));
    budget.remaining -= batch.length;
  }
  return expiredKeys.length;
}

async function deleteExpiredShareCodes(
  store: Store,
  nowSeconds: number,
  budget: { remaining: number },
) {
  if (budget.remaining <= 0) return 0;
  const { blobs } = await store.list({
    prefix: 'share-code/v1/',
    consistency: 'strong',
  });
  const expiredKeys: string[] = [];
  for (const blob of blobs) {
    if (expiredKeys.length >= budget.remaining) break;
    const record = await store.get(blob.key, {
      type: 'json',
      consistency: 'strong',
    });
    if (!isShareCodeRecord(record) || record.expiresAt <= nowSeconds) {
      expiredKeys.push(blob.key);
    }
  }

  for (let index = 0; index < expiredKeys.length; index += DELETE_BATCH_SIZE) {
    const batch = expiredKeys.slice(index, index + DELETE_BATCH_SIZE);
    await Promise.all(batch.map((key) => store.delete(key)));
    budget.remaining -= batch.length;
  }
  return expiredKeys.length;
}

async function deleteExpiredReplayRecords(
  store: Store,
  nowSeconds: number,
  budget: { remaining: number },
) {
  if (budget.remaining <= 0) return 0;
  const { blobs } = await store.list({
    prefix: 'replay-capability/v1/',
    consistency: 'strong',
  });
  let deleted = 0;
  for (const blob of blobs) {
    if (budget.remaining <= 0) break;
    const rawRecord = await store.get(blob.key, {
      type: 'json',
      consistency: 'strong',
    });
    if (isReplayRecord(rawRecord) && rawRecord.expiresAt > nowSeconds) {
      continue;
    }

    const keys = isReplayRecord(rawRecord)
      ? [
          replayDedupKey(rawRecord.digest),
          shareCodeKey(rawRecord.shareCode),
          blob.key,
        ]
      : [blob.key];
    const selectedKeys = keys.slice(0, budget.remaining);
    for (
      let index = 0;
      index < selectedKeys.length;
      index += DELETE_BATCH_SIZE
    ) {
      const batch = selectedKeys.slice(index, index + DELETE_BATCH_SIZE);
      await Promise.all(batch.map((key) => store.delete(key)));
      deleted += batch.length;
      budget.remaining -= batch.length;
    }
    if (selectedKeys.length < keys.length) break;
  }
  return deleted;
}

export async function cleanupExpired(
  data: Store,
  control: Store,
  today: string,
  maximumDeletes = MAX_DELETES_PER_RUN,
) {
  const budget = { remaining: maximumDeletes };
  const { directories } = await data.list({
    prefix: 'v1/',
    directories: true,
    consistency: 'strong',
  });
  let deleted = 0;
  for (const directory of directories.sort()) {
    const match = /^v1\/exp=(\d{4}-\d{2}-\d{2})\/$/.exec(directory);
    if (!match || match[1] >= today || budget.remaining <= 0) continue;
    deleted += await deletePrefix(data, directory, budget);
  }

  const { directories: quotaDates } = await control.list({
    prefix: 'quota/',
    directories: true,
    consistency: 'strong',
  });
  for (const directory of quotaDates.sort()) {
    const match = /^quota\/(\d{4}-\d{2}-\d{2})\/$/.exec(directory);
    if (!match || match[1] >= today || budget.remaining <= 0) continue;
    deleted += await deletePrefix(control, directory, budget);
  }
  deleted += await deleteExpiredLocks(control, today, budget);
  deleted += await deleteExpiredReplayRecords(
    control,
    Math.floor(Date.now() / 1000),
    budget,
  );
  deleted += await deleteExpiredShareCodes(
    control,
    Math.floor(Date.now() / 1000),
    budget,
  );
  return { deleted, complete: budget.remaining > 0 };
}

export async function onRequestPost(_context: FunctionContext) {
  const today = shanghaiDay();
  const control = getStore(CONTROL_STORE_NAME);
  const lockKey = `cleanup-lock/${today}`;
  let completed = false;
  try {
    try {
      await control.set(lockKey, 'running', {
        onlyIfNew: true,
        cacheControl: null,
      });
    } catch (error) {
      if (error instanceof PreconditionFailedError) {
        return new Response(null, { status: 204 });
      }
      throw error;
    }

    const data = getStore(DATA_STORE_NAME);
    const result = await cleanupExpired(data, control, today);
    const { deleted } = result;
    completed = result.complete;
    if (completed) {
      await control.set(lockKey, `complete:${deleted}`, { cacheControl: null });
    }
    return jsonResponse({ deleted, complete: completed });
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (!completed) await control.delete(lockKey).catch(() => undefined);
  }
}
