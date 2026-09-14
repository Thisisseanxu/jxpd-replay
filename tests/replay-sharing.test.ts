import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { unzipSync } from 'fflate';
import {
  PagesBlobError,
  PreconditionFailedError,
  QuotaExceededError,
  type Store,
} from '@edgeone/pages-blob';
import {
  createReplayContainer,
  MAX_REPLAY_CONTAINER_BYTES,
  parseReplayContainer,
  verifyReplayContainerOutput,
} from '../src/utils/replay-container';
import {
  packReplayLossless,
  unpackReplayLossless,
} from '../cloud-functions/_shared/replay-pack';
import { MAX_PACKED_REPLAY_BYTES } from '../cloud-functions/_shared/constants';
import {
  ANONYMOUS_REPLAY_ID,
  anonymizeReplay,
  detectReplayPrivacy,
  inspectReplay,
} from '../src/utils/replay';
import {
  createCapability,
  parseCapability,
} from '../cloud-functions/_shared/capability';
import {
  assertUploadRequest,
  HttpError,
  readLimitedBody,
} from '../cloud-functions/_shared/http';
import { claimGlobal, claimSlots } from '../cloud-functions/_shared/quota';
import {
  validateContainer,
  validateReplay,
} from '../cloud-functions/_shared/replay-validation';
import { cleanupExpired } from '../cloud-functions/api/internal/replay-cleanup';
import { replayContentResponse } from '../cloud-functions/api/replays/content';
import { replayCodeResponse } from '../cloud-functions/api/replays/code';
import { replayUploadResponse } from '../cloud-functions/api/replays/index';
import {
  shareCodeKey,
  SHARE_CODE_LENGTH,
} from '../cloud-functions/_shared/share-code';
import { LocalFileStore } from '../dev/local-file-store';
import {
  isKnownPath,
  isShareCodePath,
  isSharePath,
  sharePagePath,
} from '../src/utils/routes';
import {
  putReplayHandoff,
  takeReplayHandoff,
} from '../src/utils/replay-handoff';
import {
  createReplayDownload,
  defaultSharedReplayName,
  normalizeDownloadName,
} from '../src/utils/replay-download';

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

function lengthDelimitedField(number: number, value: Uint8Array) {
  return concat([Uint8Array.of((number << 3) | 2, value.length), value]);
}

function fixed64Field(number: number, value: bigint) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return concat([Uint8Array.of((number << 3) | 1), bytes]);
}

function replayWithIdentity(
  id: bigint,
  name: string,
  roomName: string,
  marker = false,
) {
  const player = concat([
    fixed64Field(1, id),
    lengthDelimitedField(2, new TextEncoder().encode(name)),
  ]);
  const room = concat([
    lengthDelimitedField(2, new TextEncoder().encode(roomName)),
    lengthDelimitedField(9, player),
  ]);
  return concat([
    frame(1003, lengthDelimitedField(1, room)),
    marker
      ? frame(
          1016,
          lengthDelimitedField(11, new TextEncoder().encode('anon-test')),
        )
      : frame(1016, Uint8Array.of(8, 1)),
  ]);
}

function validReplay(extraFrames: Uint8Array[] = []) {
  return concat([
    frame(1003, Uint8Array.from([0x0a, 0x02, 0x08, 0x01])),
    ...extraFrames,
    frame(1016, Uint8Array.from([0x08, 0x01])),
  ]);
}

function serverContainer(replay: Uint8Array, privacy = 1) {
  const packed = packReplayLossless(replay);
  const compressed = brotliCompressSync(packed, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const result = new Uint8Array(47 + compressed.length);
  result.set(Buffer.from('JXRS'));
  result[4] = 1;
  result[5] = 1;
  result[6] = privacy;
  new DataView(result.buffer).setUint32(7, replay.length, false);
  new DataView(result.buffer).setUint32(11, packed.length, false);
  result.set(createHash('sha256').update(replay).digest(), 15);
  result.set(compressed, 47);
  return result;
}

function uploadRequest(
  body: Uint8Array,
  extraHeaders: Record<string, string> = {},
) {
  return new Request('https://example.com/api/replays', {
    method: 'POST',
    headers: {
      'content-type': 'application/vnd.jxpd.replay-share-v1',
      'x-replay-retention': '7',
      ...extraHeaders,
    },
    body: body.slice().buffer,
  });
}

function uploadEnvironment(inviteCode = 'trusted-code') {
  const pepper = 'invite-pepper-that-is-long-enough';
  return {
    pepper,
    env: {
      REPLAY_QUOTA_SECRET: 'quota-secret-that-is-long-enough',
      REPLAY_DEVICE_SECRET: 'device-secret-that-is-long-enough',
      REPLAY_INVITE_PEPPER: pepper,
      REPLAY_INVITES_JSON: JSON.stringify([
        {
          id: 'trusted-test',
          digest: createHmac('sha256', pepper).update(inviteCode).digest('hex'),
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
      (name === 'replay-data' ? data : control) as unknown as Store,
  };
}

function expectHttpStatus(action: () => unknown, status: number) {
  try {
    action();
    throw new Error('expected HttpError');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(status);
  }
}

class MemoryStore {
  values = new Map<string, unknown>();
  failSetOnce = false;
  setErrorOnce: unknown = null;
  failDeleteOnce = false;
  failGetOnce = false;

  async set(
    key: string,
    value: string | ArrayBuffer,
    options?: { onlyIfNew?: boolean },
  ) {
    if (this.setErrorOnce) {
      const error = this.setErrorOnce;
      this.setErrorOnce = null;
      throw error;
    }
    if (this.failSetOnce) {
      this.failSetOnce = false;
      throw new Error('temporary blob failure');
    }
    if (options?.onlyIfNew && this.values.has(key)) {
      throw new PreconditionFailedError();
    }
    this.values.set(key, value);
  }

  async setJSON(
    key: string,
    value: unknown,
    options?: { onlyIfNew?: boolean },
  ) {
    await this.set(key, JSON.stringify(value), options);
  }

  async delete(key: string) {
    if (this.failDeleteOnce) {
      this.failDeleteOnce = false;
      throw new Error('temporary blob failure');
    }
    this.values.delete(key);
  }

  async get(key: string, options: { type?: string } = {}) {
    if (this.failGetOnce) {
      this.failGetOnce = false;
      throw new Error('temporary blob failure');
    }
    const value = this.values.get(key);
    if (value === undefined) return null;
    if (options.type === 'json') {
      return typeof value === 'string' ? JSON.parse(value) : value;
    }
    return value;
  }

  async getMetadata(key: string) {
    return this.values.has(key) ? { etag: key } : null;
  }

  async list(
    options: { prefix?: string; directories?: boolean; limit?: number } = {},
  ) {
    const prefix = options.prefix || '';
    const keys = [...this.values.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();
    if (options.directories) {
      const directories = new Set<string>();
      const blobs: Array<{ key: string; etag: string }> = [];
      for (const key of keys) {
        const remainder = key.slice(prefix.length);
        const slash = remainder.indexOf('/');
        if (slash >= 0)
          directories.add(`${prefix}${remainder.slice(0, slash + 1)}`);
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

describe('JXRS v1 container', () => {
  it('losslessly restores frame order, duplicate payloads, and signed command IDs', () => {
    const repeated = Uint8Array.of(0x08, 0x96, 0x01);
    const replay = concat([
      frame(-123, new Uint8Array()),
      frame(1003, repeated),
      frame(1016, repeated),
      frame(1003, repeated),
    ]);
    const packed = packReplayLossless(replay);
    expect(unpackReplayLossless(packed, replay.length)).toEqual(replay);
    expect(() =>
      unpackReplayLossless(
        packed.subarray(0, packed.length - 1),
        replay.length,
      ),
    ).toThrow();
  });

  it('round-trips metadata and verifies SHA-256', async () => {
    const replay = validReplay();
    const packed = packReplayLossless(replay);
    const compressed = brotliCompressSync(packed);
    const container = await createReplayContainer(
      replay,
      packed,
      compressed,
      'custom',
    );
    const parsed = parseReplayContainer(container);
    expect(parsed.privacyMode).toBe('custom');
    expect(parsed.originalLength).toBe(replay.length);
    expect(parsed.packedLength).toBe(packed.length);
    expect(unpackReplayLossless(packed, replay.length)).toEqual(replay);
    await expect(
      verifyReplayContainerOutput(parsed, replay),
    ).resolves.toBeUndefined();

    const damaged = replay.slice();
    damaged[damaged.length - 1] ^= 1;
    await expect(verifyReplayContainerOutput(parsed, damaged)).rejects.toThrow(
      '校验失败',
    );
  });

  it('enforces 262,143 / 262,144 / 262,145-byte boundaries', () => {
    const make = (size: number) => {
      const bytes = new Uint8Array(size);
      bytes.set(new TextEncoder().encode('JXRS'));
      bytes[4] = 1;
      bytes[5] = 1;
      bytes[6] = 1;
      new DataView(bytes.buffer).setUint32(7, 1, false);
      new DataView(bytes.buffer).setUint32(11, 1, false);
      return bytes;
    };
    expect(parseReplayContainer(make(262_143)).compressed.length).toBe(262_096);
    expect(
      parseReplayContainer(make(MAX_REPLAY_CONTAINER_BYTES)).compressed.length,
    ).toBe(262_097);
    expect(() => parseReplayContainer(make(262_145))).toThrow('大小无效');
  });

  it('rejects unknown versions', () => {
    const container = serverContainer(validReplay());
    container[4] = 2;
    expect(() => parseReplayContainer(container)).toThrow('JXRS v2');
    expectHttpStatus(() => validateContainer(container), 422);
  });
});

describe('replay privacy detection', () => {
  it('recognizes anonymous, custom, and original replay files', () => {
    expect(
      detectReplayPrivacy(
        inspectReplay(replayWithIdentity(992331n, 'Player1', 'match', true)),
      ),
    ).toBe('anonymous');
    expect(
      detectReplayPrivacy(
        inspectReplay(replayWithIdentity(992331n, 'Alice', 'match', true)),
      ),
    ).toBe('custom');
    expect(
      detectReplayPrivacy(
        inspectReplay(replayWithIdentity(42n, 'Alice', 'arena')),
      ),
    ).toBe('original');

    const source = inspectReplay(replayWithIdentity(42n, 'Alice', 'arena'));
    expect(
      detectReplayPrivacy(
        inspectReplay(anonymizeReplay(source, new Set(), false).bytes),
      ),
    ).toBe('anonymous');
    const customAnalysis = inspectReplay(
      anonymizeReplay(
        inspectReplay(replayWithIdentity(42n, 'Alice', 'arena', true)),
        new Set([1]),
        true,
      ).bytes,
    );
    expect(detectReplayPrivacy(customAnalysis)).toBe('custom');
  });

  it('produces deterministic website-marked anonymous replay bytes', () => {
    const source = inspectReplay(replayWithIdentity(42n, 'Alice', 'arena'));
    const first = anonymizeReplay(source, new Set(), false);
    const second = anonymizeReplay(source, new Set(), false);

    expect(first.replayId).toBe(ANONYMOUS_REPLAY_ID);
    expect(second.replayId).toBe(ANONYMOUS_REPLAY_ID);
    expect(second.bytes).toEqual(first.bytes);
  });
});

describe('share routes', () => {
  it('recognizes the share page and preserves fragment capabilities', () => {
    expect(isSharePath('/share')).toBe(true);
    expect(isSharePath('/share/')).toBe(true);
    expect(isShareCodePath('/share/code')).toBe(true);
    expect(isShareCodePath('/share/code/')).toBe(true);
    expect(isKnownPath('/share/code')).toBe(true);
    expect(isSharePath('/')).toBe(false);
    expect(sharePagePath('?from=tool', '#/r/test')).toBe(
      '/share?from=tool#/r/test',
    );
  });
});

describe('shared replay downloads', () => {
  it('uses the capability suffix as the default download name', () => {
    expect(
      defaultSharedReplayName('abcdefghijklmnopqrstuvwxyz123456789012345'),
    ).toBe('jxpd-replay-89012345');
  });

  it('sanitizes a custom name and falls back when it is empty', () => {
    expect(normalizeDownloadName('  round:/one?.replay  ')).toBe(
      'round__one_.replay',
    );
    expect(normalizeDownloadName('   ', 'default-replay')).toBe(
      'default-replay',
    );
  });

  it('creates a zip with one same-named folder and replay file', () => {
    const replay = Uint8Array.of(1, 2, 3, 4);
    const payload = createReplayDownload(replay, {
      fileName: 'round-01',
      zip: true,
    });

    expect(payload.fileName).toBe('round-01.zip');
    expect(payload.mimeType).toBe('application/zip');
    expect(Object.keys(unzipSync(payload.bytes))).toEqual([
      'round-01/round-01',
    ]);
    expect(unzipSync(payload.bytes)['round-01/round-01']).toEqual(replay);
  });

  it('keeps the replay file uncompressed when the zip switch is off', () => {
    const replay = Uint8Array.of(5, 6, 7);
    const payload = createReplayDownload(replay, {
      fileName: 'round-02',
      zip: false,
    });

    expect(payload.fileName).toBe('round-02');
    expect(payload.mimeType).toBe('application/octet-stream');
    expect(payload.bytes).toEqual(replay);
  });
});

describe('replay handoffs', () => {
  beforeEach(async () => {
    globalThis.indexedDB = indexedDB;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('jxpd-replay-handoff');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('database reset blocked'));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('round-trips bytes once and isolates handoff targets', async () => {
    await putReplayHandoff(
      'share',
      Uint8Array.of(1, 2, 3),
      'anon.replay',
      'anonymous',
    );

    await expect(takeReplayHandoff('anonymizer')).resolves.toBeNull();
    await expect(takeReplayHandoff('share')).resolves.toEqual({
      fileName: 'anon.replay',
      bytes: Uint8Array.of(1, 2, 3),
      privacyMode: 'anonymous',
    });
    await expect(takeReplayHandoff('share')).resolves.toBeNull();
  });

  it('discards expired records', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await putReplayHandoff('share', Uint8Array.of(7), 'expired.replay');
    clock.mockReturnValue(301_001);

    await expect(takeReplayHandoff('share')).resolves.toBeNull();
  });
});
describe('server replay validation', () => {
  it('accepts unknown command IDs while requiring room and finish frames', () => {
    const unknown = frame(29_999, Uint8Array.from([0x08, 0x96, 0x01]));
    expect(validateReplay(validReplay([unknown])).frameCount).toBe(3);
    expect(
      validateContainer(serverContainer(validReplay([unknown]))),
    ).toMatchObject({
      privacyMode: 'anonymous',
      frameCount: 3,
    });
  });

  it('rejects truncation, fake room markers, invalid protobuf, and forged hashes', () => {
    expectHttpStatus(() => validateReplay(Uint8Array.from([0, 1, 0])), 422);
    expectHttpStatus(
      () =>
        validateReplay(
          concat([
            frame(1003, new Uint8Array()),
            frame(1016, Uint8Array.of(8, 1)),
          ]),
        ),
      422,
    );
    expectHttpStatus(
      () => validateReplay(validReplay([frame(7, Uint8Array.of(0x08, 0x80))])),
      422,
    );

    const forgedLength = serverContainer(validReplay());
    new DataView(forgedLength.buffer).setUint32(
      7,
      validReplay().length + 1,
      false,
    );
    expectHttpStatus(() => validateContainer(forgedLength), 422);

    const forgedHash = serverContainer(validReplay());
    forgedHash[15] ^= 1;
    expectHttpStatus(() => validateContainer(forgedHash), 422);

    const forgedPackedLength = serverContainer(validReplay());
    new DataView(forgedPackedLength.buffer).setUint32(
      11,
      new DataView(forgedPackedLength.buffer).getUint32(11, false) + 1,
      false,
    );
    expectHttpStatus(() => validateContainer(forgedPackedLength), 422);
  });

  it('stops Brotli output above the packed replay limit', () => {
    const bomb = new Uint8Array(MAX_PACKED_REPLAY_BYTES + 1);
    const compressed = brotliCompressSync(bomb);
    const container = new Uint8Array(47 + compressed.length);
    container.set(new TextEncoder().encode('JXRS'));
    container[4] = 1;
    container[5] = 1;
    container[6] = 1;
    new DataView(container.buffer).setUint32(7, 1, false);
    new DataView(container.buffer).setUint32(
      11,
      MAX_PACKED_REPLAY_BYTES,
      false,
    );
    container.set(compressed, 47);
    expect(container.length).toBeLessThan(MAX_REPLAY_CONTAINER_BYTES);
    expectHttpStatus(() => validateContainer(container), 422);
  });

  it('caps the total frame count', () => {
    const emptyFrames = Array.from({ length: 100_000 }, () =>
      frame(2_000, new Uint8Array()),
    );
    expectHttpStatus(() => validateReplay(validReplay(emptyFrames)), 422);
  });
});

describe('upload request limits', () => {
  it('reads 262,143 and 262,144 bytes but rejects byte 262,145', async () => {
    for (const size of [262_143, 262_144]) {
      const request = new Request('https://example.com/api/replays', {
        method: 'POST',
        body: new Uint8Array(size).buffer,
      });
      await expect(readLimitedBody(request)).resolves.toHaveLength(size);
    }
    const oversized = new Request('https://example.com/api/replays', {
      method: 'POST',
      body: new Uint8Array(262_145).buffer,
    });
    await expect(readLimitedBody(oversized)).rejects.toMatchObject({
      status: 413,
    });
  });

  it('rejects an oversized Content-Length before reading', () => {
    const request = new Request('https://example.com/api/replays', {
      method: 'POST',
      headers: {
        'content-type': 'application/vnd.jxpd.replay-share-v1',
        'content-length': '262145',
        origin: 'https://example.com',
      },
      body: new Uint8Array([1]).buffer,
    });
    expectHttpStatus(() => assertUploadRequest(request), 413);
  });
});

describe('upload API policies', () => {
  it('stores a valid anonymous replay and returns a fragment capability plus short code', async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    const response = await replayUploadResponse(
      {
        request: uploadRequest(serverContainer(validReplay())),
        clientIp: '203.0.113.1',
        env,
      },
      stores.factory,
    );
    expect(response.status).toBe(201);
    const result = (await response.json()) as {
      shareUrl: string;
      shareCode: string;
      storedBytes: number;
    };
    expect(result.shareUrl).toMatch(
      /^https:\/\/example\.com\/share#\/r\/[A-Za-z0-9_-]{39}$/,
    );
    expect(result.shareCode).toMatch(
      new RegExp(`^[A-Za-z0-9]{${SHARE_CODE_LENGTH}}$`),
    );
    expect(result.storedBytes).toBeGreaterThan(43);
    expect(stores.data.values.size).toBe(1);
    expect(
      [...stores.control.values.keys()].filter((key) =>
        key.startsWith('share-code/v1/'),
      ),
    ).toHaveLength(1);
    expect(response.headers.get('set-cookie')).toContain('__Host-jxpd_device=');

    const resolved = await replayCodeResponse(
      new Request(
        `https://example.com/api/replays/code?code=${result.shareCode}`,
      ),
      stores.control as unknown as Store,
    );
    expect(resolved.status).toBe(200);
    await expect(resolved.json()).resolves.toMatchObject({
      token: result.shareUrl.split('/share#/r/')[1],
    });
  });

  it('reuses the link, share code, and data object while refreshing an identical upload', async () => {
    vi.useFakeTimers();
    try {
      const stores = memoryStores();
      const { env } = uploadEnvironment();
      const body = serverContainer(validReplay());
      vi.setSystemTime(new Date('2026-09-14T00:00:00Z'));
      const firstResponse = await replayUploadResponse(
        {
          request: uploadRequest(body),
          clientIp: '203.0.113.40',
          env,
        },
        stores.factory,
      );
      const first = (await firstResponse.json()) as {
        shareUrl: string;
        shareCode: string;
        expiresAt: string;
      };

      vi.setSystemTime(new Date('2026-09-15T02:00:00Z'));
      const secondResponse = await replayUploadResponse(
        {
          request: uploadRequest(body),
          clientIp: '203.0.113.40',
          env,
        },
        stores.factory,
      );
      const second = (await secondResponse.json()) as typeof first;

      expect(second.shareUrl).toBe(first.shareUrl);
      expect(second.shareCode).toBe(first.shareCode);
      expect(Date.parse(second.expiresAt)).toBeGreaterThan(
        Date.parse(first.expiresAt),
      );
      expect(stores.data.values.size).toBe(1);
      expect(
        [...stores.control.values.keys()].filter((key) => key.includes('/ip/')),
      ).toHaveLength(2);

      const token = first.shareUrl.split('/share#/r/')[1];
      const afterOriginalExpiry =
        Math.floor(Date.parse(first.expiresAt) / 1000) + 60 * 60;
      const download = await replayContentResponse(
        new Request('https://example.com/api/replays/content', {
          headers: { Authorization: `Replay ${token}` },
        }),
        stores.data as unknown as Store,
        afterOriginalExpiry,
        stores.control as unknown as Store,
      );
      expect(download.status).toBe(200);

      const resolved = await replayCodeResponse(
        new Request(
          `https://example.com/api/replays/code?code=${first.shareCode}`,
        ),
        stores.control as unknown as Store,
        afterOriginalExpiry,
      );
      expect(resolved.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it('collapses concurrent identical uploads into one share', async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    const body = serverContainer(validReplay());
    const responses = await Promise.all(
      ['203.0.113.41', '203.0.113.42'].map((clientIp) =>
        replayUploadResponse(
          { request: uploadRequest(body), clientIp, env },
          stores.factory,
        ),
      ),
    );
    const results = (await Promise.all(
      responses.map((response) => response.json()),
    )) as Array<{ shareUrl: string; shareCode: string }>;

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(new Set(results.map((result) => result.shareUrl)).size).toBe(1);
    expect(new Set(results.map((result) => result.shareCode)).size).toBe(1);
    expect(stores.data.values.size).toBe(1);
    expect(
      [...stores.control.values.keys()].filter((key) =>
        key.startsWith('share-code/v1/'),
      ),
    ).toHaveLength(1);
  });

  it('rejects malformed and expired share codes', async () => {
    const stores = memoryStores();
    const capability = createCapability(7);
    await stores.control.setJSON(shareCodeKey('ABC123'), {
      token: capability.token,
      expiresAt: capability.expiresAt,
    });

    const malformed = await replayCodeResponse(
      new Request('https://example.com/api/replays/code?code=short'),
      stores.control as unknown as Store,
    );
    expect(malformed.status).toBe(400);

    const expired = await replayCodeResponse(
      new Request('https://example.com/api/replays/code?code=ABC123'),
      stores.control as unknown as Store,
      capability.expiresAt,
    );
    expect(expired.status).toBe(404);
    expect(stores.control.values.has(shareCodeKey('ABC123'))).toBe(false);
  });

  it('charges invalid input to subjects but not to global valid-upload quota', async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    const response = await replayUploadResponse(
      {
        request: uploadRequest(new Uint8Array(44)),
        clientIp: '203.0.113.2',
        env,
      },
      stores.factory,
    );
    expect(response.status).toBe(422);
    const keys = [...stores.control.values.keys()];
    expect(keys.filter((key) => key.includes('/global/'))).toHaveLength(0);
    expect(
      keys.filter((key) => key.includes('/ip/') || key.includes('/device/')),
    ).toHaveLength(2);
  });

  it('charges invalid invite attempts to IP/device without reserving invite or global quota', async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    const response = await replayUploadResponse(
      {
        request: uploadRequest(serverContainer(validReplay()), {
          'x-replay-retention': '90',
          'x-replay-invite': 'wrong-code',
        }),
        clientIp: '203.0.113.21',
        env,
      },
      stores.factory,
    );
    expect(response.status).toBe(401);
    const keys = [...stores.control.values.keys()];
    expect(
      keys.filter((key) => key.includes('/ip/') || key.includes('/device/')),
    ).toHaveLength(2);
    expect(
      keys.filter(
        (key) => key.includes('/invite/') || key.includes('/global/'),
      ),
    ).toHaveLength(0);
  });

  it('rolls back the global reservation when replay Blob storage fails', async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    stores.data.failSetOnce = true;
    const response = await replayUploadResponse(
      {
        request: uploadRequest(serverContainer(validReplay())),
        clientIp: '203.0.113.20',
        env,
      },
      stores.factory,
    );
    expect(response.status).toBe(500);
    expect(
      [...stores.control.values.keys()].filter((key) =>
        key.includes('/global/'),
      ),
    ).toHaveLength(0);
    expect(stores.data.values.size).toBe(0);
  });

  it.each([
    new QuotaExceededError(),
    new PagesBlobError('CREDENTIAL_ERROR', 'storage quota exceeded'),
    new PagesBlobError('COS_ERROR', 'COS returned 413: storage quota exceeded'),
  ])(
    'reports Blob capacity exhaustion as a temporary busy response',
    async (error) => {
      const stores = memoryStores();
      const { env } = uploadEnvironment();
      stores.data.setErrorOnce = error;

      const response = await replayUploadResponse(
        {
          request: uploadRequest(serverContainer(validReplay())),
          clientIp: '203.0.113.22',
          env,
        },
        stores.factory,
      );

      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('3600');
      await expect(response.json()).resolves.toEqual({
        error: '网站过于繁忙，请之后再来',
      });
      expect(
        [...stores.control.values.keys()].filter((key) =>
          key.includes('/global/'),
        ),
      ).toHaveLength(0);
      expect(stores.data.values.size).toBe(0);
    },
  );

  it('enforces five anonymous uploads per IP', async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    const body = serverContainer(validReplay());
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push(
        (
          await replayUploadResponse(
            { request: uploadRequest(body), clientIp: '203.0.113.3', env },
            stores.factory,
          )
        ).status,
      );
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('enforces five anonymous uploads per signed device across IPs', async () => {
    const stores = memoryStores();
    const { env } = uploadEnvironment();
    const body = serverContainer(validReplay());
    const first = await replayUploadResponse(
      { request: uploadRequest(body), clientIp: '198.51.100.1', env },
      stores.factory,
    );
    const cookie = first.headers.get('set-cookie')!.split(';', 1)[0];
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

  it('accepts an HMAC invite for 90 days and enforces its 20-upload group quota', async () => {
    const stores = memoryStores();
    const inviteCode = 'trusted-code';
    const { env } = uploadEnvironment(inviteCode);
    const body = serverContainer(validReplay());
    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      statuses.push(
        (
          await replayUploadResponse(
            {
              request: uploadRequest(body, {
                'x-replay-retention': '90',
                'x-replay-invite': inviteCode,
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
      [...stores.control.values.keys()].filter((key) =>
        key.includes('/trusted/invite/trusted-test/'),
      ),
    ).toHaveLength(20);
  });
});

describe('capabilities and atomic quotas', () => {
  it('creates a 192-bit-random capability without putting it in the object path', () => {
    const capability = createCapability(7);
    expect(capability.token).toMatch(/^[A-Za-z0-9_-]{39}$/);
    expect(capability.key).not.toContain(capability.token);
    expect(parseCapability(capability.token)).toEqual(capability);
    expectHttpStatus(
      () => parseCapability(`${capability.token.slice(0, -1)}!`),
      401,
    );
  });

  it('returns 410 immediately for expiry, 404 for absence, and 500 for Blob failure', async () => {
    const memory = new MemoryStore();
    const store = memory as unknown as Store;
    const capability = createCapability(7);
    const request = new Request('https://example.com/api/replays/content', {
      headers: { Authorization: `Replay ${capability.token}` },
    });
    expect(
      (await replayContentResponse(request, store, capability.expiresAt))
        .status,
    ).toBe(410);
    expect((await replayContentResponse(request, store)).status).toBe(404);
    memory.failGetOnce = true;
    expect((await replayContentResponse(request, store)).status).toBe(500);
  });

  it('serves validated bytes with private, non-sniffable response headers', async () => {
    const memory = new MemoryStore();
    const store = memory as unknown as Store;
    const capability = createCapability(7);
    const container = serverContainer(validReplay(), 2);
    memory.values.set(capability.key, container.slice().buffer);
    const response = await replayContentResponse(
      new Request('https://example.com/api/replays/content', {
        headers: { Authorization: `Replay ${capability.token}` },
      }),
      store,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-replay-privacy')).toBe('custom');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(container);
  });

  it('allows exactly the configured number of concurrent subject slots', async () => {
    const memory = new MemoryStore();
    const store = memory as unknown as Store;
    const outcomes = await Promise.allSettled(
      Array.from({ length: 25 }, () =>
        claimSlots(store, 'quota/day/ip/id', 20),
      ),
    );
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(
      20,
    );
    expect(outcomes.filter((item) => item.status === 'rejected')).toHaveLength(
      5,
    );
  });

  it('reserves global quota atomically and can roll a failed write back', async () => {
    const memory = new MemoryStore();
    const store = memory as unknown as Store;
    const first = await claimGlobal(store, 'quota/day/global/anonymous', 2);
    await claimGlobal(store, 'quota/day/global/anonymous', 2);
    await expect(
      claimGlobal(store, 'quota/day/global/anonymous', 2),
    ).rejects.toMatchObject({
      status: 429,
    });
    await store.delete(first);
    await expect(
      claimGlobal(store, 'quota/day/global/anonymous', 2),
    ).resolves.toContain('/0');
  });
});

describe('expiry cleanup', () => {
  it('deletes only expired date prefixes and is idempotent', async () => {
    const data = new MemoryStore();
    const control = new MemoryStore();
    data.values.set('v1/exp=2026-09-04/aa/a', 'old');
    data.values.set('v1/exp=2026-09-06/bb/b', 'today');
    data.values.set('v1/exp=2026-10-01/cc/c', 'future');
    control.values.set('quota/2026-09-05/anonymous/ip/a/0', 'old');
    control.values.set('quota/2026-09-06/anonymous/ip/b/0', 'today');
    control.values.set('cleanup-lock/2026-09-05', 'complete:1');
    control.values.set('cleanup-lock/2026-09-06', 'running');
    control.values.set('cleanup-lock/2026-10-01', 'future');
    control.values.set('cleanup-lock/not-a-date', 'ignored');

    const first = await cleanupExpired(
      data as unknown as Store,
      control as unknown as Store,
      '2026-09-06',
    );
    expect(first).toEqual({ deleted: 3, complete: true });
    expect([...data.values.keys()]).toEqual([
      'v1/exp=2026-09-06/bb/b',
      'v1/exp=2026-10-01/cc/c',
    ]);
    expect([...control.values.keys()]).toEqual([
      'quota/2026-09-06/anonymous/ip/b/0',
      'cleanup-lock/2026-09-06',
      'cleanup-lock/2026-10-01',
      'cleanup-lock/not-a-date',
    ]);
    await expect(
      cleanupExpired(
        data as unknown as Store,
        control as unknown as Store,
        '2026-09-06',
      ),
    ).resolves.toEqual({ deleted: 0, complete: true });
  });

  it('removes expired share code mappings while retaining live mappings', async () => {
    const data = new MemoryStore();
    const control = new MemoryStore();
    const expired = createCapability(7);
    const live = createCapability(7);
    await control.setJSON(shareCodeKey('OLD123'), {
      token: expired.token,
      expiresAt: 1,
    });
    await control.setJSON(shareCodeKey('LIVE12'), {
      token: live.token,
      expiresAt: live.expiresAt,
    });

    await expect(
      cleanupExpired(
        data as unknown as Store,
        control as unknown as Store,
        '2026-09-14',
      ),
    ).resolves.toMatchObject({ deleted: 1, complete: true });
    expect(control.values.has(shareCodeKey('OLD123'))).toBe(false);
    expect(control.values.has(shareCodeKey('LIVE12'))).toBe(true);
  });

  it('counts old cleanup locks against the shared deletion budget', async () => {
    const data = new MemoryStore();
    const control = new MemoryStore();
    control.values.set('cleanup-lock/2026-09-03', 'complete:1');
    control.values.set('cleanup-lock/2026-09-04', 'complete:2');
    control.values.set('cleanup-lock/2026-09-06', 'running');

    await expect(
      cleanupExpired(
        data as unknown as Store,
        control as unknown as Store,
        '2026-09-06',
        1,
      ),
    ).resolves.toEqual({ deleted: 1, complete: false });
    expect([...control.values.keys()]).toEqual([
      'cleanup-lock/2026-09-04',
      'cleanup-lock/2026-09-06',
    ]);
  });

  it('resumes after a page budget or temporary delete failure', async () => {
    const data = new MemoryStore();
    const control = new MemoryStore();
    for (let index = 0; index < 5; index += 1) {
      data.values.set(`v1/exp=2026-09-01/aa/${index}`, 'old');
    }
    const first = await cleanupExpired(
      data as unknown as Store,
      control as unknown as Store,
      '2026-09-06',
      2,
    );
    expect(first).toEqual({ deleted: 2, complete: false });
    expect(data.values.size).toBe(3);

    data.failDeleteOnce = true;
    await expect(
      cleanupExpired(
        data as unknown as Store,
        control as unknown as Store,
        '2026-09-06',
      ),
    ).rejects.toThrow('temporary blob failure');
    await expect(
      cleanupExpired(
        data as unknown as Store,
        control as unknown as Store,
        '2026-09-06',
      ),
    ).resolves.toEqual({ deleted: 1, complete: true });
  });
});

describe('local file Blob store', () => {
  it('persists a complete share across Store instances', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jxpd-local-blob-'));
    try {
      const data = new LocalFileStore(root, 'replay-data');
      const control = new LocalFileStore(root, 'replay-control');
      const factory = (name: string) =>
        (name === 'replay-data' ? data : control).asEdgeOneStore();
      const { env } = uploadEnvironment();
      const container = serverContainer(validReplay());

      const upload = await replayUploadResponse(
        {
          request: uploadRequest(container),
          clientIp: '127.0.0.1',
          env,
        },
        factory,
      );
      expect(upload.status).toBe(201);
      const result = (await upload.json()) as { shareUrl: string };
      const capability = result.shareUrl.split('/share#/r/')[1];

      const reopenedData = new LocalFileStore(
        root,
        'replay-data',
      ).asEdgeOneStore();
      const download = await replayContentResponse(
        new Request('http://localhost/api/replays/content', {
          headers: { Authorization: `Replay ${capability}` },
        }),
        reopenedData,
      );
      expect(download.status).toBe(200);
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(container);

      const listing = await data.list({
        prefix: 'v1/',
        directories: true,
      });
      expect(listing.directories).toHaveLength(1);
      expect(listing.directories[0]).toMatch(/^v1\/exp=\d{4}-\d{2}-\d{2}\/$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('implements atomic onlyIfNew writes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'jxpd-local-blob-'));
    try {
      const store = new LocalFileStore(root, 'control');
      const outcomes = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          store.set('quota/slot', '1', { onlyIfNew: true }),
        ),
      );
      expect(
        outcomes.filter((item) => item.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        outcomes.filter((item) => item.status === 'rejected'),
      ).toHaveLength(9);
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(PreconditionFailedError);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
