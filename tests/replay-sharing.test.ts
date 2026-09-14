import { createHash, createHmac } from "node:crypto";
import {
  brotliCompressSync,
  constants as zlibConstants,
} from "node:zlib";
import { describe, expect, it } from "vitest";
import { PreconditionFailedError, type Store } from "@edgeone/pages-blob";
import {
  createReplayContainer,
  MAX_REPLAY_CONTAINER_BYTES,
  parseReplayContainer,
  verifyReplayContainerOutput,
} from "../src/utils/replay-container";
import { createCapability, parseCapability } from "../cloud-functions/_shared/capability";
import { assertUploadRequest, HttpError, readLimitedBody } from "../cloud-functions/_shared/http";
import { claimGlobal, claimSlots } from "../cloud-functions/_shared/quota";
import { validateContainer, validateReplay } from "../cloud-functions/_shared/replay-validation";
import { cleanupExpired } from "../cloud-functions/api/internal/replay-cleanup";
import { replayContentResponse } from "../cloud-functions/api/replays/content";
import { replayUploadResponse } from "../cloud-functions/api/replays/index";

function concat(parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function frame(commandId: number, payload: Uint8Array) {
  const result = new Uint8Array(6 + payload.length);
  const view = new DataView(result.buffer);
  view.setInt16(0, commandId, false);
  view.setInt32(2, payload.length, false);
  result.set(payload, 6);
  return result;
}

function validReplay(extraFrames: Uint8Array[] = []) {
  return concat([
    frame(1003, Uint8Array.from([0x0a, 0x02, 0x08, 0x01])),
    ...extraFrames,
    frame(1016, Uint8Array.from([0x08, 0x01])),
  ]);
}

function serverContainer(replay: Uint8Array, privacy = 1) {
  const compressed = brotliCompressSync(replay, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const result = new Uint8Array(43 + compressed.length);
  result.set(Buffer.from("JXRS"));
  result[4] = 1;
  result[5] = 1;
  result[6] = privacy;
  new DataView(result.buffer).setUint32(7, replay.length, false);
  result.set(createHash("sha256").update(replay).digest(), 11);
  result.set(compressed, 43);
  return result;
}

function uploadRequest(body: Uint8Array, extraHeaders: Record<string, string> = {}) {
  return new Request("https://example.com/api/replays", {
    method: "POST",
    headers: {
      "content-type": "application/vnd.jxpd.replay-share-v1",
      "x-replay-retention": "7",
      ...extraHeaders,
    },
    body: body.slice().buffer,
  });
}

function uploadEnvironment(inviteCode = "trusted-code") {
  const pepper = "invite-pepper-that-is-long-enough";
  return {
    pepper,
    env: {
      REPLAY_QUOTA_SECRET: "quota-secret-that-is-long-enough",
      REPLAY_DEVICE_SECRET: "device-secret-that-is-long-enough",
      REPLAY_INVITE_PEPPER: pepper,
      REPLAY_INVITES_JSON: JSON.stringify([
        {
          id: "trusted-test",
          digest: createHmac("sha256", pepper).update(inviteCode).digest("hex"),
          retentionDays: 90,
        },
      ]),
    },
  };
}

function memoryStores() {
  const data = new MemoryStore();
  const control = new MemoryStore();
  return {
    data,
    control,
    factory: (name: string) =>
      (name === "replay-data" ? data : control) as unknown as Store,
  };
}

function expectHttpStatus(action: () => unknown, status: number) {
  try {
    action();
    throw new Error("expected HttpError");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(status);
  }
}

class MemoryStore {
  values = new Map<string, unknown>();
  failSetOnce = false;
  failDeleteOnce = false;
  failGetOnce = false;

  async set(key: string, value: string, options?: { onlyIfNew?: boolean }) {
    if (this.failSetOnce) {
      this.failSetOnce = false;
      throw new Error("temporary blob failure");
    }
    if (options?.onlyIfNew && this.values.has(key)) {
      throw new PreconditionFailedError();
    }
    this.values.set(key, value);
  }

  async delete(key: string) {
    if (this.failDeleteOnce) {
      this.failDeleteOnce = false;
      throw new Error("temporary blob failure");
    }
    this.values.delete(key);
  }

  async get(key: string) {
    if (this.failGetOnce) {
      this.failGetOnce = false;
      throw new Error("temporary blob failure");
    }
    return (this.values.get(key) as ArrayBuffer | undefined) ?? null;
  }

  async list(options: { prefix?: string; directories?: boolean; limit?: number } = {}) {
    const prefix = options.prefix || "";
    const keys = [...this.values.keys()].filter((key) => key.startsWith(prefix)).sort();
    if (options.directories) {
      const directories = new Set<string>();
      const blobs: Array<{ key: string; etag: string }> = [];
      for (const key of keys) {
        const remainder = key.slice(prefix.length);
        const slash = remainder.indexOf("/");
        if (slash >= 0) directories.add(`${prefix}${remainder.slice(0, slash + 1)}`);
        else blobs.push({ key, etag: key });
      }
      return { blobs, directories: [...directories] };
    }
    return {
      blobs: keys.slice(0, options.limit).map((key) => ({ key, etag: key })),
      directories: [],
    };
  }
}

describe("JXRS v1 container", () => {
  it("round-trips metadata and verifies SHA-256", async () => {
    const replay = validReplay();
    const compressed = brotliCompressSync(replay);
    const container = await createReplayContainer(replay, compressed, "custom");
    const parsed = parseReplayContainer(container);
    expect(parsed.privacyMode).toBe("custom");
    expect(parsed.originalLength).toBe(replay.length);
    await expect(verifyReplayContainerOutput(parsed, replay)).resolves.toBeUndefined();

    const damaged = replay.slice();
    damaged[damaged.length - 1] ^= 1;
    await expect(verifyReplayContainerOutput(parsed, damaged)).rejects.toThrow("校验失败");
  });

  it("enforces 81,919 / 81,920 / 81,921-byte boundaries", () => {
    const make = (size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set(new TextEncoder().encode("JXRS"));
      bytes[4] = 1;
      bytes[5] = 1;
      bytes[6] = 1;
      new DataView(bytes.buffer).setUint32(7, 1, false);
      return bytes;
    };
    expect(parseReplayContainer(make(81_919)).compressed.length).toBe(81_876);
    expect(parseReplayContainer(make(MAX_REPLAY_CONTAINER_BYTES)).compressed.length).toBe(81_877);
    expect(() => parseReplayContainer(make(81_921))).toThrow("大小无效");
  });

  it("rejects unknown versions", () => {
    const container = serverContainer(validReplay());
    container[4] = 2;
    expect(() => parseReplayContainer(container)).toThrow("JXRS v2");
    expectHttpStatus(() => validateContainer(container), 422);
  });
});

describe("server replay validation", () => {
  it("accepts unknown command IDs while requiring room and finish frames", () => {
    const unknown = frame(29_999, Uint8Array.from([0x08, 0x96, 0x01]));
    expect(validateReplay(validReplay([unknown])).frameCount).toBe(3);
    expect(validateContainer(serverContainer(validReplay([unknown])))).toMatchObject({
      privacyMode: "anonymous",
      frameCount: 3,
    });
  });

  it("rejects truncation, fake room markers, invalid protobuf, and forged hashes", () => {
    expectHttpStatus(() => validateReplay(Uint8Array.from([0, 1, 0])), 422);
    expectHttpStatus(
      () => validateReplay(concat([frame(1003, new Uint8Array()), frame(1016, Uint8Array.of(8, 1))])),
      422,
    );
    expectHttpStatus(
      () => validateReplay(validReplay([frame(7, Uint8Array.of(0x08, 0x80))])),
      422,
    );

    const forgedLength = serverContainer(validReplay());
    new DataView(forgedLength.buffer).setUint32(7, validReplay().length + 1, false);
    expectHttpStatus(() => validateContainer(forgedLength), 422);

    const forgedHash = serverContainer(validReplay());
    forgedHash[11] ^= 1;
    expectHttpStatus(() => validateContainer(forgedHash), 422);
  });

  it("stops Brotli output above 8 MiB", () => {
    const bomb = new Uint8Array(8 * 1024 * 1024 + 1);
    const container = serverContainer(bomb);
    new DataView(container.buffer).setUint32(7, 8 * 1024 * 1024, false);
    expect(container.length).toBeLessThan(MAX_REPLAY_CONTAINER_BYTES);
    expectHttpStatus(() => validateContainer(container), 422);
  });

  it("caps the total frame count", () => {
    const emptyFrames = Array.from({ length: 100_000 }, () => frame(2_000, new Uint8Array()));
    expectHttpStatus(() => validateReplay(validReplay(emptyFrames)), 422);
  });
});

describe("upload request limits", () => {
  it("reads 81,919 and 81,920 bytes but rejects byte 81,921", async () => {
    for (const size of [81_919, 81_920]) {
      const request = new Request("https://example.com/api/replays", {
        method: "POST",
        body: new Uint8Array(size).buffer,
      });
      await expect(readLimitedBody(request)).resolves.toHaveLength(size);
    }
    const oversized = new Request("https://example.com/api/replays", {
      method: "POST",
      body: new Uint8Array(81_921).buffer,
    });
    await expect(readLimitedBody(oversized)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects an oversized Content-Length before reading", () => {
    const request = new Request("https://example.com/api/replays", {
      method: "POST",
      headers: {
        "content-type": "application/vnd.jxpd.replay-share-v1",
        "content-length": "81921",
        origin: "https://example.com",
      },
      body: new Uint8Array([1]).buffer,
    });
    expectHttpStatus(() => assertUploadRequest(request), 413);
  });

});

describe("upload API policies", () => {
  it("stores a valid anonymous replay and returns only a fragment capability", async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    const response = await replayUploadResponse(
      {
        request: uploadRequest(serverContainer(validReplay())),
        clientIp: "203.0.113.1",
        env,
      },
      stores.factory,
    );
    expect(response.status).toBe(201);
    const result = (await response.json()) as { shareUrl: string; storedBytes: number };
    expect(result.shareUrl).toMatch(/^https:\/\/example\.com\/#\/r\/[A-Za-z0-9_-]{39}$/);
    expect(result.storedBytes).toBeGreaterThan(43);
    expect(stores.data.values.size).toBe(1);
    expect(response.headers.get("set-cookie")).toContain("__Host-jxpd_device=");
  });

  it("charges invalid input to subjects but not to global valid-upload quota", async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    const response = await replayUploadResponse(
      {
        request: uploadRequest(new Uint8Array(44)),
        clientIp: "203.0.113.2",
        env,
      },
      stores.factory,
    );
    expect(response.status).toBe(422);
    const keys = [...stores.control.values.keys()];
    expect(keys.filter((key) => key.includes("/global/"))).toHaveLength(0);
    expect(keys.filter((key) => key.includes("/ip/") || key.includes("/device/"))).toHaveLength(2);
  });

  it("charges invalid invite attempts to IP/device without reserving invite or global quota", async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    const response = await replayUploadResponse(
      {
        request: uploadRequest(serverContainer(validReplay()), {
          "x-replay-retention": "90",
          "x-replay-invite": "wrong-code",
        }),
        clientIp: "203.0.113.21",
        env,
      },
      stores.factory,
    );
    expect(response.status).toBe(401);
    const keys = [...stores.control.values.keys()];
    expect(keys.filter((key) => key.includes("/ip/") || key.includes("/device/"))).toHaveLength(2);
    expect(keys.filter((key) => key.includes("/invite/") || key.includes("/global/"))).toHaveLength(0);
  });

  it("rolls back the global reservation when replay Blob storage fails", async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    stores.data.failSetOnce = true;
    const response = await replayUploadResponse(
      {
        request: uploadRequest(serverContainer(validReplay())),
        clientIp: "203.0.113.20",
        env,
      },
      stores.factory,
    );
    expect(response.status).toBe(500);
    expect([...stores.control.values.keys()].filter((key) => key.includes("/global/"))).toHaveLength(0);
    expect(stores.data.values.size).toBe(0);
  });

  it("enforces five anonymous uploads per IP", async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    const body = serverContainer(validReplay());
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push(
        (
          await replayUploadResponse(
            { request: uploadRequest(body), clientIp: "203.0.113.3", env },
            stores.factory,
          )
        ).status,
      );
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it("enforces five anonymous uploads per signed device across IPs", async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    const body = serverContainer(validReplay());
    const first = await replayUploadResponse(
      { request: uploadRequest(body), clientIp: "198.51.100.1", env },
      stores.factory,
    );
    const cookie = first.headers.get("set-cookie")!.split(";", 1)[0];
    const statuses = [first.status];
    for (let index = 2; index <= 6; index += 1) {
      statuses.push(
        (
          await replayUploadResponse(
            {
              request: uploadRequest(body, { cookie }),
              clientIp: `198.51.100.${index}`,
              env,
            },
            stores.factory,
          )
        ).status,
      );
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it("accepts an HMAC invite for 90 days and enforces its 20-upload group quota", async () => {
    const stores = memoryStores();
    const inviteCode = "trusted-code";
    const { env } = uploadEnvironment(inviteCode);
    const body = serverContainer(validReplay());
    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      statuses.push(
        (
          await replayUploadResponse(
            {
              request: uploadRequest(body, {
                "x-replay-retention": "90",
                "x-replay-invite": inviteCode,
              }),
              clientIp: `192.0.2.${index + 1}`,
              env,
            },
            stores.factory,
          )
        ).status,
      );
    }
    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(201));
    expect(statuses[20]).toBe(429);
    expect(
      [...stores.control.values.keys()].filter((key) => key.includes("/trusted/invite/trusted-test/")),
    ).toHaveLength(20);
  });
});

describe("capabilities and atomic quotas", () => {
  it("creates a 192-bit-random capability without putting it in the object path", () => {
    const capability = createCapability(7);
    expect(capability.token).toMatch(/^[A-Za-z0-9_-]{39}$/);
    expect(capability.key).not.toContain(capability.token);
    expect(parseCapability(capability.token)).toEqual(capability);
    expectHttpStatus(() => parseCapability(`${capability.token.slice(0, -1)}!`), 401);
  });

  it("returns 410 immediately for expiry, 404 for absence, and 500 for Blob failure", async () => {
    const memory = new MemoryStore();
    const store = memory as unknown as Store;
    const capability = createCapability(7);
    const request = new Request("https://example.com/api/replays/content", {
      headers: { Authorization: `Replay ${capability.token}` },
    });
    expect((await replayContentResponse(request, store, capability.expiresAt)).status).toBe(410);
    expect((await replayContentResponse(request, store)).status).toBe(404);
    memory.failGetOnce = true;
    expect((await replayContentResponse(request, store)).status).toBe(500);
  });

  it("serves validated bytes with private, non-sniffable response headers", async () => {
    const memory = new MemoryStore();
    const store = memory as unknown as Store;
    const capability = createCapability(7);
    const container = serverContainer(validReplay(), 2);
    memory.values.set(capability.key, container.slice().buffer);
    const response = await replayContentResponse(
      new Request("https://example.com/api/replays/content", {
        headers: { Authorization: `Replay ${capability.token}` },
      }),
      store,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-replay-privacy")).toBe("custom");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(container);
  });

  it("allows exactly the configured number of concurrent subject slots", async () => {
    const memory = new MemoryStore();
    const store = memory as unknown as Store;
    const outcomes = await Promise.allSettled(
      Array.from({ length: 25 }, () => claimSlots(store, "quota/day/ip/id", 20)),
    );
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(20);
    expect(outcomes.filter((item) => item.status === "rejected")).toHaveLength(5);
  });

  it("reserves global quota atomically and can roll a failed write back", async () => {
    const memory = new MemoryStore();
    const store = memory as unknown as Store;
    const first = await claimGlobal(store, "quota/day/global/anonymous", 2);
    await claimGlobal(store, "quota/day/global/anonymous", 2);
    await expect(claimGlobal(store, "quota/day/global/anonymous", 2)).rejects.toMatchObject({
      status: 429,
    });
    await store.delete(first);
    await expect(claimGlobal(store, "quota/day/global/anonymous", 2)).resolves.toContain("/0");
  });
});

describe("expiry cleanup", () => {
  it("deletes only expired date prefixes and is idempotent", async () => {
    const data = new MemoryStore();
    const control = new MemoryStore();
    data.values.set("v1/exp=2026-09-04/aa/a", "old");
    data.values.set("v1/exp=2026-09-06/bb/b", "today");
    data.values.set("v1/exp=2026-10-01/cc/c", "future");
    control.values.set("quota/2026-09-05/anonymous/ip/a/0", "old");
    control.values.set("quota/2026-09-06/anonymous/ip/b/0", "today");

    const first = await cleanupExpired(
      data as unknown as Store,
      control as unknown as Store,
      "2026-09-06",
    );
    expect(first).toEqual({ deleted: 2, complete: true });
    expect([...data.values.keys()]).toEqual([
      "v1/exp=2026-09-06/bb/b",
      "v1/exp=2026-10-01/cc/c",
    ]);
    expect([...control.values.keys()]).toEqual([
      "quota/2026-09-06/anonymous/ip/b/0",
    ]);
    await expect(
      cleanupExpired(
        data as unknown as Store,
        control as unknown as Store,
        "2026-09-06",
      ),
    ).resolves.toEqual({ deleted: 0, complete: true });
  });

  it("resumes after a page budget or temporary delete failure", async () => {
    const data = new MemoryStore();
    const control = new MemoryStore();
    for (let index = 0; index < 5; index += 1) {
      data.values.set(`v1/exp=2026-09-01/aa/${index}`, "old");
    }
    const first = await cleanupExpired(
      data as unknown as Store,
      control as unknown as Store,
      "2026-09-06",
      2,
    );
    expect(first).toEqual({ deleted: 2, complete: false });
    expect(data.values.size).toBe(3);

    data.failDeleteOnce = true;
    await expect(
      cleanupExpired(
        data as unknown as Store,
        control as unknown as Store,
        "2026-09-06",
      ),
    ).rejects.toThrow("temporary blob failure");
    await expect(
      cleanupExpired(
        data as unknown as Store,
        control as unknown as Store,
        "2026-09-06",
      ),
    ).resolves.toEqual({ deleted: 1, complete: true });
  });
});
