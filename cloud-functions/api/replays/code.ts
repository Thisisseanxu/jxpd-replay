import { getStore, type Store } from '@edgeone/pages-blob';
import { CONTROL_STORE_NAME } from '../../_shared/constants.js';
import type { FunctionContext } from '../../_shared/constants.js';
import { parseCapability } from '../../_shared/capability.js';
import { errorResponse, HttpError, jsonResponse } from '../../_shared/http.js';
import {
  isReplayRecord,
  replayCapabilityKey,
} from '../../_shared/replay-record.js';
import {
  isShareCodeRecord,
  parseShareCode,
  shareCodeKey,
} from '../../_shared/share-code.js';

const INVALID_CODE_MESSAGE = '分享码无效或已过期';

export async function replayCodeResponse(
  request: Request,
  control: Store,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  try {
    const code = parseShareCode(
      new URL(request.url).searchParams.get('code') || '',
    );
    const key = shareCodeKey(code);
    const rawRecord = await control.get(key, {
      type: 'json',
      consistency: 'strong',
    });
    if (!isShareCodeRecord(rawRecord)) {
      throw new HttpError(404, INVALID_CODE_MESSAGE);
    }

    let capability;
    try {
      capability = parseCapability(rawRecord.token);
    } catch {
      await control.delete(key).catch(() => undefined);
      throw new HttpError(404, INVALID_CODE_MESSAGE);
    }

    const rawReplayRecord = await control.get(
      replayCapabilityKey(capability.token),
      { type: 'json', consistency: 'strong' },
    );
    const replayRecord =
      isReplayRecord(rawReplayRecord) &&
      rawReplayRecord.token === capability.token
        ? rawReplayRecord
        : null;
    const expiresAt = replayRecord?.expiresAt ?? rawRecord.expiresAt;

    if (
      expiresAt <= nowSeconds ||
      (!replayRecord && capability.expiresAt <= nowSeconds)
    ) {
      await control.delete(key).catch(() => undefined);
      throw new HttpError(404, INVALID_CODE_MESSAGE);
    }

    return jsonResponse({
      token: capability.token,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestGet(context: FunctionContext) {
  return replayCodeResponse(context.request, getStore(CONTROL_STORE_NAME));
}
