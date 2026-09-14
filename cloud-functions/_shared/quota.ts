import {
  PreconditionFailedError,
  type Store,
} from "@edgeone/pages-blob";
import { HttpError } from "./http.js";

export async function claimSlots(
  store: Store,
  prefix: string,
  limit: number,
) {
  for (let slot = 0; slot < limit; slot += 1) {
    try {
      await store.set(`${prefix}/${slot}`, "1", {
        onlyIfNew: true,
        cacheControl: null,
      });
      return `${prefix}/${slot}`;
    } catch (error) {
      if (!(error instanceof PreconditionFailedError)) throw error;
    }
  }
  throw new HttpError(429, "今天的分享额度已用完，请明天再试");
}

export async function claimGlobal(
  store: Store,
  prefix: string,
  limit: number,
) {
  try {
    return await claimSlots(store, prefix, limit);
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) {
      throw new HttpError(429, "今天的全站分享额度已用完，请明天再试");
    }
    throw error;
  }
}
