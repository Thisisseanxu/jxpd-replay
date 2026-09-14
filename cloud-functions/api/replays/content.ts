import { getStore, type Store } from '@edgeone/pages-blob';
import { CONTROL_STORE_NAME, DATA_STORE_NAME } from '../../_shared/constants.js';
import type { FunctionContext } from '../../_shared/constants.js';
import { parseCapability } from '../../_shared/capability.js';
import { errorResponse, HttpError } from '../../_shared/http.js';
import {
  isReplayRecord,
  replayCapabilityKey,
} from '../../_shared/replay-record.js';

export async function replayContentResponse(
  request: Request,
  store: Store,
  nowSeconds = Math.floor(Date.now() / 1000),
  control?: Store,
) {
  try {
    const authorization = request.headers.get('authorization') || '';
    const match = /^Replay ([A-Za-z0-9_-]+)$/.exec(authorization);
    if (!match) throw new HttpError(401, '分享链接无效');
    const capability = parseCapability(match[1]);
    const rawRecord = control
      ? await control.get(replayCapabilityKey(capability.token), {
          type: 'json',
          consistency: 'strong',
        })
      : null;
    const replayRecord =
      isReplayRecord(rawRecord) && rawRecord.token === capability.token
        ? rawRecord
        : null;
    const expiresAt = replayRecord?.expiresAt ?? capability.expiresAt;
    const dataKey = replayRecord?.dataKey ?? capability.key;
    if (expiresAt <= nowSeconds) {
      throw new HttpError(410, '这个分享链接已经过期');
    }

    const body = await store.get(dataKey, {
      type: 'arrayBuffer',
      consistency: 'strong',
    });
    if (!body) throw new HttpError(404, '没有找到这个回放');
    const bytes = new Uint8Array(body);
    const privacyCode = bytes[6];
    const privacy =
      privacyCode === 0
        ? 'original'
        : privacyCode === 1
          ? 'anonymous'
          : 'custom';
    return new Response(body, {
      headers: {
        'Content-Type': 'application/vnd.jxpd.replay-share-v1',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Replay-Expires-At': new Date(expiresAt * 1000).toISOString(),
        'X-Replay-Privacy': privacy,
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestGet(context: FunctionContext) {
  return replayContentResponse(
    context.request,
    getStore(DATA_STORE_NAME),
    Math.floor(Date.now() / 1000),
    getStore(CONTROL_STORE_NAME),
  );
}
