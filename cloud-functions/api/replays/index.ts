import { getStore, type Store } from "@edgeone/pages-blob";
import {
  CONTROL_STORE_NAME,
  DATA_STORE_NAME,
} from "../../_shared/constants";
import type { FunctionContext } from "../../_shared/constants";
import { createCapability } from "../../_shared/capability";
import { isBlobCapacityError } from "../../_shared/blob-errors";
import {
  deviceIdentity,
  quotaHash,
  requiredSecret,
  shanghaiDay,
  validateInvite,
} from "../../_shared/identity";
import {
  assertUploadRequest,
  errorResponse,
  HttpError,
  jsonResponse,
  readLimitedBody,
} from "../../_shared/http";
import { claimGlobal, claimSlots } from "../../_shared/quota";
import { validateContainer } from "../../_shared/replay-validation";

export async function replayUploadResponse(
  context: FunctionContext,
  storeFactory: (name: string) => Store = getStore,
) {
  try {
    const { request } = context;
    assertUploadRequest(request);
    const env = context.env || process.env;
    const quotaSecret = requiredSecret(env, "REPLAY_QUOTA_SECRET");
    const deviceSecret = requiredSecret(env, "REPLAY_DEVICE_SECRET");
    const inviteCode = request.headers.get("x-replay-invite")?.trim() || "";
    const requestedRetention = Number(
      request.headers.get("x-replay-retention") || "7",
    );
    const today = shanghaiDay();
    const device = deviceIdentity(request, deviceSecret);
    const clientIp = context.clientIp || "local-development";

    let tier: "anonymous" | "trusted" = "anonymous";
    let retentionDays = 7;
    let perSubjectLimit = 5;
    let globalLimit = 500;
    if (requestedRetention === 90) {
      if (!inviteCode) throw new HttpError(401, "保存 90 天需要邀请码");
      tier = "trusted";
      retentionDays = 90;
      perSubjectLimit = 20;
      globalLimit = 50;
    } else if (requestedRetention !== 7) {
      throw new HttpError(400, "保存期限只能是 7 天或 90 天");
    }

    const control = storeFactory(CONTROL_STORE_NAME);
    const ipHash = quotaHash(quotaSecret, `${today}|ip|${clientIp}`);
    const deviceHash = quotaHash(
      quotaSecret,
      `${today}|device|${device.id}`,
    );
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
    if (tier === "trusted") {
      const pepper = requiredSecret(env, "REPLAY_INVITE_PEPPER");
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

    const capability = createCapability(retentionDays);
    const data = storeFactory(DATA_STORE_NAME);
    try {
      const arrayBuffer = body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer;
      await data.set(capability.key, arrayBuffer, {
        onlyIfNew: true,
        cacheControl: null,
      });
    } catch (error) {
      await control.delete(globalReservation).catch(() => undefined);
      throw error;
    }

    const origin = new URL(request.url).origin;
    return jsonResponse(
      {
        shareUrl: `${origin}/share#/r/${capability.token}`,
        expiresAt: new Date(capability.expiresAt * 1000).toISOString(),
        originalBytes: validated.originalBytes,
        storedBytes: validated.storedBytes,
        privacyMode: validated.privacyMode,
      },
      201,
      device.setCookie ? { "Set-Cookie": device.setCookie } : {},
    );
  } catch (error) {
    if (isBlobCapacityError(error)) {
      return jsonResponse(
        { error: "网站过于繁忙，请之后再来" },
        503,
        { "Retry-After": "3600" },
      );
    }
    return errorResponse(error);
  }
}

export async function onRequestPost(context: FunctionContext) {
  return replayUploadResponse(context);
}
