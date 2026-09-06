export type WireValue = bigint | Uint8Array

export type WireField = {
  number: number
  wireType: number
  value: WireValue
}

export type ReplayFrame = {
  commandId: number
  payload: Uint8Array
}

export type PlayerRecord = {
  id: bigint
  label: string
  originalName: string
}

export type ReplayAnalysis = {
  frames: ReplayFrame[]
  frameCount: number
  size: number
  roomName: string
  players: PlayerRecord[]
  commandCount: number
}

type TransformContext = {
  players: Map<string, PlayerRecord>
  revealPlayers: Set<number>
  preserveRoomName: boolean
  replayId: string
  changedFields: number
}

const textDecoder = new TextDecoder('utf-8', { fatal: false })
const textEncoder = new TextEncoder()

function readVarint(data: Uint8Array, start: number) {
  let value = 0n
  let shift = 0n
  let position = start

  while (position < data.length && shift <= 63n) {
    const byte = data[position]
    position += 1
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, next: position }
    shift += 7n
  }

  throw new Error('回放中的 protobuf varint 无法解析')
}

function encodeVarint(value: bigint) {
  const bytes: number[] = []
  let current = value < 0n ? value & 0xffffffffffffffffn : value

  do {
    let byte = Number(current & 0x7fn)
    current >>= 7n
    if (current !== 0n) byte |= 0x80
    bytes.push(byte)
  } while (current !== 0n)

  return Uint8Array.from(bytes)
}

function concatBytes(parts: Uint8Array[]) {
  const total = parts.reduce((size, part) => size + part.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

function parseFields(data: Uint8Array): WireField[] {
  const fields: WireField[] = []
  let position = 0

  while (position < data.length) {
    const tag = readVarint(data, position)
    position = tag.next
    const number = Number(tag.value >> 3n)
    const wireType = Number(tag.value & 7n)
    if (number === 0) throw new Error('回放中出现无效 protobuf 字段')

    if (wireType === 0) {
      const result = readVarint(data, position)
      fields.push({ number, wireType, value: result.value })
      position = result.next
    } else if (wireType === 1) {
      if (position + 8 > data.length) throw new Error('回放 fixed64 字段被截断')
      fields.push({ number, wireType, value: data.slice(position, position + 8) })
      position += 8
    } else if (wireType === 2) {
      const size = readVarint(data, position)
      position = size.next
      const length = Number(size.value)
      if (!Number.isSafeInteger(length) || position + length > data.length) {
        throw new Error('回放 length-delimited 字段被截断')
      }
      fields.push({ number, wireType, value: data.slice(position, position + length) })
      position += length
    } else if (wireType === 5) {
      if (position + 4 > data.length) throw new Error('回放 fixed32 字段被截断')
      fields.push({ number, wireType, value: data.slice(position, position + 4) })
      position += 4
    } else {
      throw new Error(`暂不支持 protobuf wire type ${wireType}`)
    }
  }

  return fields
}

function encodeFields(fields: WireField[]) {
  const parts: Uint8Array[] = []
  for (const field of fields) {
    parts.push(encodeVarint((BigInt(field.number) << 3n) | BigInt(field.wireType)))
    if (field.wireType === 0) {
      parts.push(encodeVarint(field.value as bigint))
    } else if (field.wireType === 1 || field.wireType === 5) {
      parts.push(field.value as Uint8Array)
    } else if (field.wireType === 2) {
      const value = field.value as Uint8Array
      parts.push(encodeVarint(BigInt(value.length)), value)
    }
  }
  return concatBytes(parts)
}

function fixed64(value: WireValue) {
  const bytes = value as Uint8Array
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getBigUint64(0, true)
}

function asText(value: WireValue) {
  return textDecoder.decode(value as Uint8Array)
}

function asBytes(value: string) {
  return textEncoder.encode(value)
}

function getField(fields: WireField[], number: number) {
  return fields.find((field) => field.number === number)
}

function looksLikePlayer(fields: WireField[]) {
  const hasPlayerIdentity = getField(fields, 1)?.wireType === 1 && getField(fields, 2)?.wireType === 2
  if (!hasPlayerIdentity) return false

  // Room 也以 fixed64 Id + string Name 开头；这些字段用于排除 Room 本身。
  const roomMarkers: Array<[number, number]> = [
    [3, 2],
    [4, 5],
    [5, 5],
    [6, 1],
    [7, 1],
    [8, 1],
    [11, 0],
  ]
  return !roomMarkers.some(([number, wireType]) => getField(fields, number)?.wireType === wireType)
}

function collectPlayer(fields: WireField[], players: Map<string, PlayerRecord>) {
  const idField = getField(fields, 1)
  const nameField = getField(fields, 2)
  if (!idField || !nameField || idField.wireType !== 1 || nameField.wireType !== 2) return

  const id = fixed64(idField.value)
  if (id === 0n) return
  const key = id.toString()
  const originalName = asText(nameField.value)
  const current = players.get(key)
  if (current) {
    if (!current.originalName && originalName) current.originalName = originalName
    return
  }

  players.set(key, {
    id,
    label: `Player${players.size + 1}`,
    originalName,
  })
}

function collectPlayersFromRoom(data: Uint8Array, players: Map<string, PlayerRecord>) {
  let fields: WireField[]
  try {
    fields = parseFields(data)
  } catch {
    return
  }

  // 只从 Room 已确认的 Players/WatchPlayers 字段取玩家，避免把 Room 当成 Player。
  for (const field of fields) {
    if ((field.number !== 9 && field.number !== 43) || field.wireType !== 2) continue
    try {
      const playerFields = parseFields(field.value as Uint8Array)
      if (looksLikePlayer(playerFields)) collectPlayer(playerFields, players)
    } catch {
      // 非相关的 repeated 字段不能阻断整个回放加载。
    }
  }
}

function readReplay(data: Uint8Array) {
  const frames: ReplayFrame[] = []
  let position = 0
  while (position < data.length) {
    if (position + 6 > data.length) throw new Error('回放文件末尾缺少完整帧头')
    const view = new DataView(data.buffer, data.byteOffset + position, 6)
    const commandId = view.getInt16(0, false)
    const payloadLength = view.getInt32(2, false)
    position += 6
    if (payloadLength < 0 || position + payloadLength > data.length) {
      throw new Error(`命令 ${commandId} 的 payload 长度无效`)
    }
    frames.push({ commandId, payload: data.slice(position, position + payloadLength) })
    position += payloadLength
  }
  if (!frames.length) throw new Error('文件中没有可播放的回放帧')
  return frames
}

function roomFromFrame(frame: ReplayFrame) {
  if (frame.commandId !== 1003 && frame.commandId !== 1113) return null
  try {
    const fields = parseFields(frame.payload)
    const roomField = getField(fields, frame.commandId === 1003 ? 1 : 2)
    return roomField?.wireType === 2 ? (roomField.value as Uint8Array) : null
  } catch {
    return null
  }
}

function firstRoomName(frames: ReplayFrame[]) {
  for (const frame of frames) {
    const room = roomFromFrame(frame)
    if (!room) continue
    try {
      const name = getField(parseFields(room), 2)
      if (name?.wireType === 2) return asText(name.value)
    } catch {
      // 继续扫描后续 Room。
    }
  }
  return ''
}

export function inspectReplay(data: Uint8Array): ReplayAnalysis {
  const frames = readReplay(data)
  const players = new Map<string, PlayerRecord>()
  for (const frame of frames) {
    const room = roomFromFrame(frame)
    if (room) collectPlayersFromRoom(room, players)
  }

  return {
    frames,
    frameCount: frames.length,
    size: data.length,
    roomName: firstRoomName(frames),
    players: Array.from(players.values()).slice(0, 4),
    commandCount: new Set(frames.map((frame) => frame.commandId)).size,
  }
}

function withText(field: WireField, value: string): WireField {
  return { ...field, value: asBytes(value) }
}

function transformPlayer(data: Uint8Array, context: TransformContext) {
  const fields = parseFields(data)
  const idField = getField(fields, 1)
  const id = idField?.wireType === 1 ? fixed64(idField.value) : 0n
  const record = context.players.get(id.toString())
  const playerNumber = record ? Number(record.label.replace('Player', '')) : 0
  const shouldReveal = context.revealPlayers.has(playerNumber)
  let changed = false

  const output = fields.flatMap((field) => {
    if (field.number === 2 && field.wireType === 2) {
      const nextName = shouldReveal && record?.originalName ? record.originalName : record?.label ?? 'Player'
      const fieldChanged = asText(field.value) !== nextName
      changed = changed || fieldChanged
      if (fieldChanged) context.changedFields += 1
      return [withText(field, nextName)]
    }

    // 凭据和账号资料 blob 不参与回放播放，清空即可降低泄露风险。
    if (field.number === 9 || field.number === 59 || field.number === 69 || field.number === 82) {
      if (field.wireType === 2 && (field.value as Uint8Array).length > 0) {
        changed = true
        context.changedFields += 1
        return [withText(field, '')]
      }
    }
    if ([42, 43, 45, 51, 201].includes(field.number)) {
      changed = true
      context.changedFields += 1
      return []
    }
    return [field]
  })

  return changed ? encodeFields(output) : data
}

function transformRoom(data: Uint8Array, context: TransformContext) {
  const fields = parseFields(data)
  let changed = false
  const output = fields.map((field) => {
    if (field.number === 2 && field.wireType === 2 && !context.preserveRoomName) {
      changed = true
      context.changedFields += 1
      return withText(field, '匿名房间')
    }
    if ((field.number === 3 || field.number === 42) && field.wireType === 2) {
      if ((field.value as Uint8Array).length > 0) {
        changed = true
        context.changedFields += 1
        return withText(field, '')
      }
    }
    if ((field.number === 9 || field.number === 43) && field.wireType === 2) {
      const next = transformPlayer(field.value as Uint8Array, context)
      changed = changed || next !== field.value
      return { ...field, value: next }
    }
    return field
  })
  return changed ? encodeFields(output) : data
}

function randomReplayId() {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return `anon-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function anonymizeReplay(analysis: ReplayAnalysis, revealPlayers: Set<number>, preserveRoomName: boolean) {
  const context: TransformContext = {
    players: new Map(analysis.players.map((player) => [player.id.toString(), player])),
    revealPlayers,
    preserveRoomName,
    replayId: randomReplayId(),
    changedFields: 0,
  }

  const frames = analysis.frames.map((frame) => {
    let payload = frame.payload
    if (frame.commandId === 1003 || frame.commandId === 1113) {
      const fields = parseFields(payload)
      const roomNumber = frame.commandId === 1003 ? 1 : 2
      const output = fields.map((field) =>
        field.number === roomNumber && field.wireType === 2
          ? { ...field, value: transformRoom(field.value as Uint8Array, context) }
          : field,
      )
      payload = encodeFields(output)
    } else if (frame.commandId === 1016) {
      const fields = parseFields(payload)
      const output = fields.map((field) =>
        field.number === 11 && field.wireType === 2 ? withText(field, context.replayId) : field,
      )
      payload = encodeFields(output)
    }
    return { ...frame, payload }
  })

  const parts: Uint8Array[] = []
  for (const frame of frames) {
    const header = new ArrayBuffer(6)
    const view = new DataView(header)
    view.setInt16(0, frame.commandId, false)
    view.setInt32(2, frame.payload.length, false)
    parts.push(new Uint8Array(header), frame.payload)
  }

  return {
    bytes: concatBytes(parts),
    replayId: context.replayId,
    changedFields: context.changedFields,
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '') || 'replay'
}
