import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { DEVICE_COOKIE_NAME } from "./constants";
import { HttpError } from "./http";

export type Invite = { id: string; digest: string; retentionDays?: number };

function signature(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export function deviceIdentity(request: Request, secret: string) {
  const current = cookieValue(request, DEVICE_COOKIE_NAME);
  if (current) {
    const [id, providedSignature] = current.split(".");
    if (
      /^[A-Za-z0-9_-]{22}$/.test(id || "") &&
      providedSignature &&
      safeEqual(signature(secret, id), providedSignature)
    ) {
      return { id, setCookie: null };
    }
  }

  const id = randomBytes(16).toString("base64url");
  const value = `${id}.${signature(secret, id)}`;
  return {
    id,
    setCookie: `${DEVICE_COOKIE_NAME}=${value}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict`,
  };
}

export function quotaHash(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function shanghaiDay() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function validateInvite(
  code: string,
  pepper: string,
  rawInvites: string | undefined,
) {
  let invites: Invite[] = [];
  try {
    invites = rawInvites ? (JSON.parse(rawInvites) as Invite[]) : [];
  } catch {
    throw new HttpError(503, "邀请码配置无效");
  }
  const digest = createHmac("sha256", pepper)
    .update(code.trim())
    .digest("hex");
  if (!Array.isArray(invites)) {
    throw new HttpError(503, "邀请码配置无效");
  }
  let invite: Invite | undefined;
  for (const candidate of invites) {
    if (
      candidate &&
      typeof candidate.digest === "string" &&
      safeEqual(candidate.digest, digest)
    ) {
      invite = candidate;
    }
  }
  if (!invite || !/^[A-Za-z0-9_-]{1,48}$/.test(invite.id)) {
    throw new HttpError(401, "邀请码无效");
  }
  const retentionDays = invite.retentionDays ?? 90;
  if (retentionDays !== 90) {
    throw new HttpError(503, "邀请码保存策略无效");
  }
  return {
    id: invite.id,
    retentionDays,
  };
}

export function requiredSecret(
  env: Record<string, string | undefined>,
  name: string,
) {
  const value = env[name];
  if (!value || value.length < 24) {
    throw new HttpError(503, `服务缺少 ${name} 配置`);
  }
  return value;
}
