import {
  getStore,
  PreconditionFailedError,
  type Store,
} from '@edgeone/pages-blob';
import { CONTROL_STORE_NAME, DATA_STORE_NAME } from '../../_shared/constants.js';
import type { FunctionContext } from '../../_shared/constants.js';
import { createCapability, objectKey } from '../../_shared/capability.js';
import {
  createShareCode,
  shareCodeKey,
  type ShareCodeRecord,
} from '../../_shared/share-code.js';
import { isBlobCapacityError } from '../../_shared/blob-errors.js';
import {
  deviceIdentity,
  quotaHash,
  requiredSecret,
  shanghaiDay,
  validateInvite,
} from '../../_shared/identity.js';
import {
  assertUploadRequest,
  errorResponse,
  HttpError,
  jsonResponse,
  readLimitedBody,
} from '../../_shared/http.js';
import { claimGlobal, claimSlots } from '../../_shared/quota.js';
import {
  isReplayRecord,
  replayCapabilityKey,
  replayDedupKey,
  replayDigest,
  type ReplayRecord,
} from '../../_shared/replay-record.js';
import { validateContainer } from '../../_shared/replay-validation.js';

async function reserveShareCode(
  control: Store,
  token: string,
  expiresAt: number,
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareCode = createShareCode();
    const key = shareCodeKey(shareCode);
    const record: ShareCodeRecord = { token, expiresAt };
    try {
      await control.setJSON(key, record, {
        onlyIfNew: true,
        cacheControl: null,
      });
      return { shareCode, key };
    } catch (error) {
      if (error instanceof PreconditionFailedError && attempt < 4) continue;
      throw error;
    }
  }
  throw new Error('无法生成唯一分享码');
}

export async function replayUploadResponse(
  context: FunctionContext,
  storeFactory: (name: string) => Store = getStore,
) {
  try {
    const { request } = context;
    assertUploadRequest(request);
    const env = context.env || process.env;
    const quotaSecret = requiredSecret(env, 'REPLAY_QUOTA_SECRET');
    const deviceSecret = requiredSecret(env, 'REPLAY_DEVICE_SECRET');
    const inviteCode = request.headers.get('x-replay-invite')?.trim() || '';
    const requestedRetention = Number(
      request.headers.get('x-replay-retention') || '7',
    );
    const today = shanghaiDay();
    const device = deviceIdentity(request, deviceSecret);
    const clientIp = context.clientIp || 'local-development';

    let tier: 'anonymous' | 'trusted' = 'anonymous';
    let retentionDays = 7;
    let perSubjectLimit = 5;
    let globalLimit = 500;
    if (requestedRetention === 90) {
      if (!inviteCode) throw new HttpError(401, '保存 90 天需要邀请码');
      tier = 'trusted';
      retentionDays = 90;
      perSubjectLimit = 20;
      globalLimit = 50;
    } else if (requestedRetention !== 7) {
      throw new HttpError(400, '保存期限只能是 7 天或 90 天');
    }

    const control = storeFactory(CONTROL_STORE_NAME);
    const ipHash = quotaHash(quotaSecret, `${today}|ip|${clientIp}`);
    const deviceHash = quotaHash(quotaSecret, `${today}|device|${device.id}`);
    await claimSlots(
      control,
      `quota/${today}/${tier}/ip/${ipHash}`,
      perSubjectLimit,
    );
    await claimSlots(
      control,
      `quota/${today}/${tier}/device/${deviceHash}`,
      perSubjectLimit,
    );
    if (tier === 'trusted') {
      const pepper = requiredSecret(env, 'REPLAY_INVITE_PEPPER');
      const invite = validateInvite(
        inviteCode,
        pepper,
        env.REPLAY_INVITES_JSON,
      );
      retentionDays = invite.retentionDays;
      await claimSlots(
        control,
        `quota/${today}/trusted/invite/${invite.id}`,
        20,
      );
    }

    const body = await readLimitedBody(request);
    const validated = validateContainer(body);
    const globalReservation = await claimGlobal(
      control,
      `quota/${today}/global/${tier}`,
      globalLimit,
    );

    const data = storeFactory(DATA_STORE_NAME);
    const digest = replayDigest(body);
    const dedupKey = replayDedupKey(digest);
    const requestedCapability = createCapability(retentionDays);
    let replayRecord: ReplayRecord | null = null;
    let previousRecord: ReplayRecord | null = null;
    let candidateCodeKey = '';
    let ownsDedupRecord = false;
    let createdDataKey = '';
    try {
      const existing = await control.get(dedupKey, {
        type: 'json',
        consistency: 'strong',
      });
      if (isReplayRecord(existing) && existing.digest === digest) {
        replayRecord = existing;
      } else {
        if (existing !== null) {
          throw new Error('回放去重索引损坏');
        }
        const reservedCode = await reserveShareCode(
          control,
          requestedCapability.token,
          requestedCapability.expiresAt,
        );
        candidateCodeKey = reservedCode.key;
        const candidate: ReplayRecord = {
          token: requestedCapability.token,
          shareCode: reservedCode.shareCode,
          expiresAt: requestedCapability.expiresAt,
          dataKey: requestedCapability.key,
          digest,
        };
        try {
          await control.setJSON(dedupKey, candidate, {
            onlyIfNew: true,
            cacheControl: null,
          });
          ownsDedupRecord = true;
          replayRecord = candidate;
        } catch (error) {
          if (!(error instanceof PreconditionFailedError)) throw error;
          const winner = await control.get(dedupKey, {
            type: 'json',
            consistency: 'strong',
          });
          if (!isReplayRecord(winner) || winner.digest !== digest) {
            throw new Error('回放去重索引无法读取');
          }
          await control.delete(candidateCodeKey).catch(() => undefined);
          candidateCodeKey = '';
          replayRecord = winner;
        }
      }

      previousRecord = replayRecord;
      const expiresAt = requestedCapability.expiresAt;
      const previousDataKey = replayRecord.dataKey;
      const nextDataKey = objectKey(replayRecord.token, expiresAt);
      const updatedRecord: ReplayRecord = {
        ...replayRecord,
        expiresAt,
        dataKey: nextDataKey,
      };
      const arrayBuffer = body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer;
      const alreadyStored =
        nextDataKey === previousDataKey &&
        (await data.getMetadata(nextDataKey, { consistency: 'strong' })) !==
          null;
      if (!alreadyStored) {
        try {
          await data.set(nextDataKey, arrayBuffer, {
            onlyIfNew: true,
            cacheControl: null,
          });
          createdDataKey = nextDataKey;
        } catch (error) {
          if (!(error instanceof PreconditionFailedError)) throw error;
        }
      }

      await control.setJSON(
        replayCapabilityKey(updatedRecord.token),
        updatedRecord,
        {
          cacheControl: null,
        },
      );
      await control.setJSON(
        shareCodeKey(updatedRecord.shareCode),
        { token: updatedRecord.token, expiresAt } satisfies ShareCodeRecord,
        { cacheControl: null },
      );
      await control.setJSON(dedupKey, updatedRecord, { cacheControl: null });
      if (previousDataKey !== nextDataKey) {
        await data.delete(previousDataKey).catch(() => undefined);
      }
      replayRecord = updatedRecord;
    } catch (error) {
      if (ownsDedupRecord) {
        if (createdDataKey) {
          await data.delete(createdDataKey).catch(() => undefined);
        }
        if (replayRecord) {
          await control
            .delete(replayCapabilityKey(replayRecord.token))
            .catch(() => undefined);
        }
        await control.delete(dedupKey).catch(() => undefined);
      } else if (previousRecord) {
        await control
          .setJSON(replayCapabilityKey(previousRecord.token), previousRecord, {
            cacheControl: null,
          })
          .catch(() => undefined);
        await control
          .setJSON(
            shareCodeKey(previousRecord.shareCode),
            {
              token: previousRecord.token,
              expiresAt: previousRecord.expiresAt,
            } satisfies ShareCodeRecord,
            { cacheControl: null },
          )
          .catch(() => undefined);
        await control
          .setJSON(dedupKey, previousRecord, { cacheControl: null })
          .catch(() => undefined);
        if (createdDataKey && createdDataKey !== previousRecord.dataKey) {
          await data.delete(createdDataKey).catch(() => undefined);
        }
      }
      if (candidateCodeKey) {
        await control.delete(candidateCodeKey).catch(() => undefined);
      }
      await control.delete(globalReservation).catch(() => undefined);
      throw error;
    }

    const origin = new URL(request.url).origin;
    return jsonResponse(
      {
        shareUrl: `${origin}/share#/r/${replayRecord.token}`,
        shareCode: replayRecord.shareCode,
        expiresAt: new Date(replayRecord.expiresAt * 1000).toISOString(),
        originalBytes: validated.originalBytes,
        storedBytes: validated.storedBytes,
        privacyMode: validated.privacyMode,
      },
      201,
      device.setCookie ? { 'Set-Cookie': device.setCookie } : {},
    );
  } catch (error) {
    if (isBlobCapacityError(error)) {
      return jsonResponse({ error: '网站过于繁忙，请之后再来' }, 503, {
        'Retry-After': '3600',
      });
    }
    return errorResponse(error);
  }
}

export async function onRequestPost(context: FunctionContext) {
  return replayUploadResponse(context);
}
