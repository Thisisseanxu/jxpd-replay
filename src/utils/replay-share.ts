import type { ReplayPrivacyMode } from "./replay-container";

type WorkerResponse = {
  id: number;
  ok: boolean;
  bytes?: ArrayBuffer;
  privacyMode?: ReplayPrivacyMode;
  error?: string;
};

export type ShareUploadResult = {
  shareUrl: string;
  shareCode: string;
  expiresAt: string;
  originalBytes: number;
  storedBytes: number;
  privacyMode: ReplayPrivacyMode;
};

export type ShareCodeResolveResult = {
  token: string;
  expiresAt: string;
};

let worker: Worker | null = null;
let requestId = 0;
const pending = new Map<
  number,
  {
    resolve: (value: WorkerResponse) => void;
    reject: (error: Error) => void;
  }
>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/replay-codec.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const target = pending.get(event.data.id);
    if (!target) return;
    pending.delete(event.data.id);
    if (event.data.ok) target.resolve(event.data);
    else target.reject(new Error(event.data.error || "回放压缩处理失败"));
  };
  worker.onerror = () => {
    for (const target of pending.values()) {
      target.reject(new Error("浏览器无法启动回放压缩器"));
    }
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

async function runWorker(
  operation: "encode" | "decode",
  bytes: Uint8Array,
  privacyMode?: ReplayPrivacyMode,
) {
  const id = ++requestId;
  const copy = bytes.slice();
  const promise = new Promise<WorkerResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  getWorker().postMessage(
    { id, operation, bytes: copy.buffer, privacyMode },
    [copy.buffer],
  );
  return promise;
}

export async function encodeReplayForShare(
  bytes: Uint8Array,
  privacyMode: ReplayPrivacyMode,
) {
  const result = await runWorker("encode", bytes, privacyMode);
  return new Uint8Array(result.bytes!);
}

export async function decodeSharedReplay(bytes: Uint8Array) {
  const result = await runWorker("decode", bytes);
  return {
    bytes: new Uint8Array(result.bytes!),
    privacyMode: result.privacyMode!,
  };
}

async function apiError(response: Response) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

export async function uploadReplay(
  container: Uint8Array,
  retentionDays: 7 | 90,
  inviteCode: string,
) {
  const body = container.slice().buffer;
  const headers: Record<string, string> = {
    "Content-Type": "application/vnd.jxpd.replay-share-v1",
    "X-Replay-Retention": String(retentionDays),
  };
  if (retentionDays === 90 && inviteCode.trim()) {
    headers["X-Replay-Invite"] = inviteCode.trim();
  }

  const response = await fetch("/api/replays", {
    method: "POST",
    credentials: "same-origin",
    headers,
    body,
  });
  if (!response.ok) throw new Error(await apiError(response));
  return (await response.json()) as ShareUploadResult;
}

export async function fetchSharedReplay(capability: string) {
  const response = await fetch("/api/replays/content", {
    credentials: "same-origin",
    headers: { Authorization: `Replay ${capability}` },
  });
  if (!response.ok) throw new Error(await apiError(response));
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    expiresAt: response.headers.get("X-Replay-Expires-At") || "",
    privacyMode: response.headers.get("X-Replay-Privacy") || "",
  };
}

export async function resolveShareCode(code: string) {
  const params = new URLSearchParams({ code: code.trim() });
  const response = await fetch(`/api/replays/code?${params.toString()}`, {
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(await apiError(response));
  return (await response.json()) as ShareCodeResolveResult;
}

export function capabilityFromHash(hash = location.hash) {
  const match = /^#\/r\/([A-Za-z0-9_-]{39})$/.exec(hash);
  return match?.[1] ?? null;
}
