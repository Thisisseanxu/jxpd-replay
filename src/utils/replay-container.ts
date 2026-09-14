export const REPLAY_CONTAINER_MAGIC = "JXRS";
export const REPLAY_CONTAINER_VERSION = 1;
export const REPLAY_CODEC_BROTLI = 1;
export const REPLAY_CONTAINER_HEADER_BYTES = 43;
export const MAX_REPLAY_CONTAINER_BYTES = 80 * 1024;
export const MAX_REPLAY_OUTPUT_BYTES = 8 * 1024 * 1024;

export type ReplayPrivacyMode = "original" | "anonymous" | "custom";

const privacyCode: Record<ReplayPrivacyMode, number> = {
  original: 0,
  anonymous: 1,
  custom: 2,
};

const privacyMode: Record<number, ReplayPrivacyMode> = {
  0: "original",
  1: "anonymous",
  2: "custom",
};

export type ReplayContainer = {
  privacyMode: ReplayPrivacyMode;
  originalLength: number;
  digest: Uint8Array;
  compressed: Uint8Array;
};

function equalBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function sha256(bytes: Uint8Array) {
  const input = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

export async function createReplayContainer(
  original: Uint8Array,
  compressed: Uint8Array,
  mode: ReplayPrivacyMode,
) {
  if (original.length > MAX_REPLAY_OUTPUT_BYTES) {
    throw new Error("回放解压后超过 8 MiB 安全上限");
  }

  const output = new Uint8Array(
    REPLAY_CONTAINER_HEADER_BYTES + compressed.length,
  );
  output.set(new TextEncoder().encode(REPLAY_CONTAINER_MAGIC), 0);
  output[4] = REPLAY_CONTAINER_VERSION;
  output[5] = REPLAY_CODEC_BROTLI;
  output[6] = privacyCode[mode];
  new DataView(output.buffer).setUint32(7, original.length, false);
  output.set(await sha256(original), 11);
  output.set(compressed, REPLAY_CONTAINER_HEADER_BYTES);

  if (output.length > MAX_REPLAY_CONTAINER_BYTES) {
    throw new Error(
      `压缩后为 ${(output.length / 1024).toFixed(1)} KiB，超过 80 KiB 分享上限`,
    );
  }
  return output;
}

export function parseReplayContainer(bytes: Uint8Array): ReplayContainer {
  if (
    bytes.length < REPLAY_CONTAINER_HEADER_BYTES + 1 ||
    bytes.length > MAX_REPLAY_CONTAINER_BYTES
  ) {
    throw new Error("分享数据大小无效");
  }

  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== REPLAY_CONTAINER_MAGIC) throw new Error("不是 JXRS 回放数据");
  if (bytes[4] !== REPLAY_CONTAINER_VERSION) {
    throw new Error(`暂不支持 JXRS v${bytes[4]}`);
  }
  if (bytes[5] !== REPLAY_CODEC_BROTLI) {
    throw new Error("暂不支持该回放压缩算法");
  }

  const mode = privacyMode[bytes[6]];
  if (!mode) throw new Error("回放隐私模式无效");
  const originalLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(7, false);
  if (
    originalLength === 0 ||
    originalLength > MAX_REPLAY_OUTPUT_BYTES
  ) {
    throw new Error("回放原始大小无效");
  }

  return {
    privacyMode: mode,
    originalLength,
    digest: bytes.slice(11, REPLAY_CONTAINER_HEADER_BYTES),
    compressed: bytes.slice(REPLAY_CONTAINER_HEADER_BYTES),
  };
}

export async function verifyReplayContainerOutput(
  container: ReplayContainer,
  output: Uint8Array,
) {
  if (output.length !== container.originalLength) {
    throw new Error("回放解压后的大小不匹配");
  }
  if (!equalBytes(await sha256(output), container.digest)) {
    throw new Error("回放校验失败，分享数据可能已损坏");
  }
}
