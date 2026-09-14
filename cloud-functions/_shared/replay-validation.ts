import { createHash } from "node:crypto";
import { brotliDecompressSync } from "node:zlib";
import {
  CONTAINER_HEADER_BYTES,
  MAX_CONTAINER_BYTES,
  MAX_REPLAY_BYTES,
  MAX_REPLAY_FRAMES,
} from "./constants";
import type { PrivacyMode } from "./constants";
import { HttpError } from "./http";

const magic = Buffer.from("JXRS");
const privacyModes: Record<number, PrivacyMode> = {
  0: "original",
  1: "anonymous",
  2: "custom",
};

function readVarint(data: Uint8Array, start: number) {
  let position = start;
  let value = 0n;
  for (let count = 0; count < 10 && position < data.length; count += 1) {
    const byte = data[position++];
    if (count === 9 && byte > 1) {
      throw new HttpError(422, "回放包含溢出的 protobuf varint");
    }
    value |= BigInt(byte & 0x7f) << BigInt(count * 7);
    if ((byte & 0x80) === 0) return { next: position, value };
  }
  throw new HttpError(422, "回放包含无效的 protobuf varint");
}

function validateProtobuf(data: Uint8Array) {
  const fields: Array<{ number: number; wireType: number; start: number; end: number }> = [];
  let position = 0;
  while (position < data.length) {
    const tag = readVarint(data, position);
    position = tag.next;
    const fieldNumber = tag.value >> 3n;
    const wireType = Number(tag.value & 7n);
    if (fieldNumber === 0n || fieldNumber > 0x1fffffffn) {
      throw new HttpError(422, "回放包含无效字段");
    }
    const valueStart = position;

    if (wireType === 0) {
      position = readVarint(data, position).next;
    } else if (wireType === 1) {
      position += 8;
    } else if (wireType === 2) {
      const length = readVarint(data, position);
      position = length.next;
      if (length.value > BigInt(data.length - position)) {
        throw new HttpError(422, "回放字段长度无效");
      }
      position += Number(length.value);
    } else if (wireType === 5) {
      position += 4;
    } else {
      throw new HttpError(422, `回放包含不支持的 wire type ${wireType}`);
    }

    if (position > data.length) throw new HttpError(422, "回放字段被截断");
    fields.push({
      number: Number(fieldNumber),
      wireType,
      start: valueStart,
      end: position,
    });
  }
  return fields;
}

export function validateReplay(bytes: Uint8Array) {
  let position = 0;
  let frameCount = 0;
  let hasRoomState = false;
  let hasFinish = false;

  while (position < bytes.length) {
    if (position + 6 > bytes.length) {
      throw new HttpError(422, "回放末尾缺少完整帧头");
    }
    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset + position,
      6,
    );
    const commandId = view.getInt16(0, false);
    const payloadLength = view.getInt32(2, false);
    position += 6;
    if (payloadLength < 0 || position + payloadLength > bytes.length) {
      throw new HttpError(422, `命令 ${commandId} 的 payload 长度无效`);
    }

    const payload = bytes.subarray(position, position + payloadLength);
    const fields = validateProtobuf(payload);
    position += payloadLength;
    frameCount += 1;
    if (frameCount > MAX_REPLAY_FRAMES) {
      throw new HttpError(422, "回放帧数超过安全上限");
    }
    if (commandId === 1003 || commandId === 1113) {
      const roomField = commandId === 1003 ? 1 : 2;
      hasRoomState ||= fields.some(
        (field) => field.number === roomField && field.wireType === 2,
      );
    }
    if (commandId === 1016 && fields.length > 0) hasFinish = true;
  }

  if (frameCount === 0) throw new HttpError(422, "回放中没有帧");
  if (!hasRoomState || !hasFinish) {
    throw new HttpError(422, "文件不是完整的吉星派对回放");
  }
  return { frameCount };
}

export function validateContainer(container: Uint8Array) {
  if (
    container.length < CONTAINER_HEADER_BYTES + 1 ||
    container.length > MAX_CONTAINER_BYTES
  ) {
    throw new HttpError(413, "分享数据大小无效");
  }
  if (!Buffer.from(container.subarray(0, 4)).equals(magic)) {
    throw new HttpError(422, "不是 JXRS 回放数据");
  }
  if (container[4] !== 1) throw new HttpError(422, "JXRS 版本不受支持");
  if (container[5] !== 1) throw new HttpError(422, "压缩算法不受支持");
  const privacyMode = privacyModes[container[6]];
  if (!privacyMode) throw new HttpError(422, "隐私模式无效");

  const declaredLength = new DataView(
    container.buffer,
    container.byteOffset,
    container.byteLength,
  ).getUint32(7, false);
  if (declaredLength === 0 || declaredLength > MAX_REPLAY_BYTES) {
    throw new HttpError(422, "回放原始大小无效");
  }

  let replay: Buffer;
  try {
    replay = brotliDecompressSync(
      container.subarray(CONTAINER_HEADER_BYTES),
      { maxOutputLength: MAX_REPLAY_BYTES },
    );
  } catch {
    throw new HttpError(422, "Brotli 回放无法安全解压");
  }
  if (replay.length !== declaredLength) {
    throw new HttpError(422, "回放解压后的大小不匹配");
  }

  const expectedDigest = container.subarray(11, CONTAINER_HEADER_BYTES);
  const actualDigest = createHash("sha256").update(replay).digest();
  if (!actualDigest.equals(expectedDigest)) {
    throw new HttpError(422, "回放 SHA-256 校验失败");
  }
  const { frameCount } = validateReplay(replay);
  return {
    privacyMode,
    originalBytes: replay.length,
    storedBytes: container.length,
    frameCount,
  };
}
