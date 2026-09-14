const PACK_MAGIC = Uint8Array.of(0x52, 0x50, 0x56, 0x31); // RPV1

type ReplayFrame = {
  commandId: number;
  payload: Uint8Array;
};

type ReplayGroup = {
  commandId: number;
  payloads: Uint8Array[];
  nextPayload: number;
};

function encodeUnsignedVarint(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('回放压缩参数超出安全整数范围');
  }
  const bytes: number[] = [];
  let current = value;
  do {
    let byte = current % 128;
    current = Math.floor(current / 128);
    if (current > 0) byte |= 0x80;
    bytes.push(byte);
  } while (current > 0);
  return Uint8Array.from(bytes);
}

function readUnsignedVarint(data: Uint8Array, start: number) {
  let value = 0;
  let multiplier = 1;
  let position = start;
  for (let count = 0; count < 8 && position < data.length; count += 1) {
    const byte = data[position++];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) throw new Error('回放压缩数据整数溢出');
    if ((byte & 0x80) === 0) return { value, next: position };
    multiplier *= 128;
  }
  throw new Error('回放压缩数据包含无效 varint');
}

function zigZagCommand(commandId: number) {
  return commandId >= 0 ? commandId * 2 : -commandId * 2 - 1;
}

function unZigZagCommand(value: number) {
  const commandId = value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  if (!Number.isInteger(commandId) || commandId < -32768 || commandId > 32767) {
    throw new Error('回放压缩数据包含无效命令号');
  }
  return commandId;
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function hasMagic(data: Uint8Array) {
  return PACK_MAGIC.every((byte, index) => data[index] === byte);
}

export function packReplayLossless(replay: Uint8Array, maxFrames = 100_000) {
  const frames: ReplayFrame[] = [];
  let position = 0;
  while (position < replay.length) {
    if (frames.length >= maxFrames) throw new Error('回放帧数超过安全上限');
    if (position + 6 > replay.length) throw new Error('回放末尾缺少完整帧头');
    const view = new DataView(replay.buffer, replay.byteOffset + position, 6);
    const commandId = view.getInt16(0, false);
    const payloadLength = view.getInt32(2, false);
    position += 6;
    if (payloadLength < 0 || position + payloadLength > replay.length) {
      throw new Error(`命令 ${commandId} 的 payload 长度无效`);
    }
    frames.push({
      commandId,
      payload: replay.subarray(position, position + payloadLength),
    });
    position += payloadLength;
  }
  if (frames.length === 0) throw new Error('回放中没有帧');

  const byCommand = new Map<number, Uint8Array[]>();
  for (const frame of frames) {
    const payloads = byCommand.get(frame.commandId);
    if (payloads) payloads.push(frame.payload);
    else byCommand.set(frame.commandId, [frame.payload]);
  }
  const groups = [...byCommand.entries()]
    .map(([commandId, payloads]) => ({ commandId, payloads }))
    .sort((left, right) => left.commandId - right.commandId);
  const groupIndex = new Map(
    groups.map((group, index) => [group.commandId, index]),
  );

  const parts: Uint8Array[] = [
    PACK_MAGIC,
    encodeUnsignedVarint(frames.length),
    encodeUnsignedVarint(groups.length),
  ];
  for (const group of groups) {
    parts.push(
      encodeUnsignedVarint(zigZagCommand(group.commandId)),
      encodeUnsignedVarint(group.payloads.length),
    );
    for (const payload of group.payloads) {
      parts.push(encodeUnsignedVarint(payload.length), payload);
    }
  }
  for (const frame of frames) {
    parts.push(encodeUnsignedVarint(groupIndex.get(frame.commandId)!));
  }
  return concatBytes(parts);
}

export function unpackReplayLossless(
  packed: Uint8Array,
  expectedReplayLength: number,
  maxFrames = 100_000,
) {
  if (!hasMagic(packed)) throw new Error('回放压缩数据格式无效');
  let position = PACK_MAGIC.length;
  const frameCountResult = readUnsignedVarint(packed, position);
  const frameCount = frameCountResult.value;
  position = frameCountResult.next;
  if (frameCount === 0 || frameCount > maxFrames) {
    throw new Error('回放压缩数据的帧数无效');
  }
  const groupCountResult = readUnsignedVarint(packed, position);
  const groupCount = groupCountResult.value;
  position = groupCountResult.next;
  if (groupCount === 0 || groupCount > frameCount || groupCount > 65_536) {
    throw new Error('回放压缩数据的命令组数量无效');
  }

  const groups: ReplayGroup[] = [];
  let totalPayloads = 0;
  let totalPayloadBytes = 0;
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const commandResult = readUnsignedVarint(packed, position);
    position = commandResult.next;
    const payloadCountResult = readUnsignedVarint(packed, position);
    position = payloadCountResult.next;
    const payloadCount = payloadCountResult.value;
    if (payloadCount === 0 || totalPayloads + payloadCount > frameCount) {
      throw new Error('回放压缩数据的 payload 数量无效');
    }
    totalPayloads += payloadCount;
    const payloads: Uint8Array[] = [];
    for (let payloadIndex = 0; payloadIndex < payloadCount; payloadIndex += 1) {
      const lengthResult = readUnsignedVarint(packed, position);
      position = lengthResult.next;
      const payloadLength = lengthResult.value;
      if (
        payloadLength > expectedReplayLength - totalPayloadBytes ||
        position + payloadLength > packed.length
      ) {
        throw new Error('回放压缩数据的 payload 长度无效');
      }
      payloads.push(packed.subarray(position, position + payloadLength));
      position += payloadLength;
      totalPayloadBytes += payloadLength;
    }
    groups.push({
      commandId: unZigZagCommand(commandResult.value),
      payloads,
      nextPayload: 0,
    });
  }
  if (
    totalPayloads !== frameCount ||
    totalPayloadBytes + frameCount * 6 !== expectedReplayLength
  ) {
    throw new Error('回放压缩数据与声明的原始长度不一致');
  }

  const output = new Uint8Array(expectedReplayLength);
  const outputView = new DataView(output.buffer);
  let outputOffset = 0;
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const indexResult = readUnsignedVarint(packed, position);
    position = indexResult.next;
    const group = groups[indexResult.value];
    if (!group || group.nextPayload >= group.payloads.length) {
      throw new Error('回放压缩数据的帧顺序无效');
    }
    const payload = group.payloads[group.nextPayload++];
    outputView.setInt16(outputOffset, group.commandId, false);
    outputView.setInt32(outputOffset + 2, payload.length, false);
    output.set(payload, outputOffset + 6);
    outputOffset += 6 + payload.length;
  }
  if (
    position !== packed.length ||
    outputOffset !== output.length ||
    groups.some((group) => group.nextPayload !== group.payloads.length)
  ) {
    throw new Error('回放压缩数据没有被完整消费');
  }
  return output;
}
