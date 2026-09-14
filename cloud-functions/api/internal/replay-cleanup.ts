import {
  getStore,
  PreconditionFailedError,
  type Store,
} from "@edgeone/pages-blob";
import {
  CONTROL_STORE_NAME,
  DATA_STORE_NAME,
} from "../../_shared/constants";
import type { FunctionContext } from "../../_shared/constants";
import { errorResponse, jsonResponse } from "../../_shared/http";

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
      consistency: "strong",
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

export async function cleanupExpired(
  data: Store,
  control: Store,
  today: string,
  maximumDeletes = MAX_DELETES_PER_RUN,
) {
  const budget = { remaining: maximumDeletes };
  const { directories } = await data.list({
    prefix: "v1/",
    directories: true,
    consistency: "strong",
  });
  let deleted = 0;
  for (const directory of directories.sort()) {
    const match = /^v1\/exp=(\d{4}-\d{2}-\d{2})\/$/.exec(directory);
    if (!match || match[1] >= today || budget.remaining <= 0) continue;
    deleted += await deletePrefix(data, directory, budget);
  }

  const { directories: quotaDates } = await control.list({
    prefix: "quota/",
    directories: true,
    consistency: "strong",
  });
  for (const directory of quotaDates.sort()) {
    const match = /^quota\/(\d{4}-\d{2}-\d{2})\/$/.exec(directory);
    if (!match || match[1] >= today || budget.remaining <= 0) continue;
    deleted += await deletePrefix(control, directory, budget);
  }
  return { deleted, complete: budget.remaining > 0 };
}

export async function onRequestPost(_context: FunctionContext) {
  const today = new Date().toISOString().slice(0, 10);
  const control = getStore(CONTROL_STORE_NAME);
  const lockKey = `cleanup-lock/${today}`;
  let completed = false;
  try {
    try {
      await control.set(lockKey, "running", {
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
