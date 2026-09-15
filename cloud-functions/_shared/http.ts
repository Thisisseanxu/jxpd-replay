import { MAX_CONTAINER_BYTES } from './constants.js';

const TRUSTED_UPLOAD_ORIGINS = new Set([
  'https://jx.mhpd.fans',
  'https://jxdev.mhpd.fans',
]);

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: HeadersInit = {},
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...Object.fromEntries(new Headers(extraHeaders)),
    },
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.message }, error.status);
  }
  console.error('Replay API error', error);
  return jsonResponse({ error: '服务暂时不可用，请稍后重试' }, 500);
}

export function assertUploadRequest(request: Request) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0];
  if (contentType !== 'application/vnd.jxpd.replay-share-v1') {
    throw new HttpError(415, '上传格式不受支持');
  }

  const requestOrigin = new URL(request.url).origin;
  const origin = request.headers.get('origin');
  let publicOrigin = requestOrigin;
  if (origin) {
    let normalizedOrigin = '';
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.origin === origin)
        normalizedOrigin = parsedOrigin.origin;
    } catch {
      // 非法 Origin 统一按跨站请求拒绝。
    }
    if (
      normalizedOrigin !== requestOrigin &&
      !TRUSTED_UPLOAD_ORIGINS.has(normalizedOrigin)
    ) {
      throw new HttpError(403, '只允许从本站上传回放');
    }
    publicOrigin = normalizedOrigin;
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTAINER_BYTES) {
    throw new HttpError(413, '压缩后的回放超过 256 KiB');
  }
  return publicOrigin;
}

function bodyChunk(value: unknown) {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError('不支持的请求正文数据类型');
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === 'function'
  );
}

export async function readLimitedBody(request: Request) {
  const body = request.body as unknown;
  if (!body) throw new HttpError(400, '上传内容为空');
  const chunks: Uint8Array[] = [];
  let total = 0;

  const append = (value: unknown) => {
    const chunk = bodyChunk(value);
    total += chunk.byteLength;
    if (total > MAX_CONTAINER_BYTES) {
      throw new HttpError(413, '压缩后的回放超过 256 KiB');
    }
    chunks.push(chunk);
  };

  if (
    typeof body === 'string' ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    append(body);
  } else if (
    typeof body === 'object' &&
    body !== null &&
    'getReader' in body &&
    typeof body.getReader === 'function'
  ) {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        try {
          append(value);
        } catch (error) {
          try {
            await reader.cancel?.();
          } catch {
            // 保留正文大小错误，不让流取消失败覆盖它。
          }
          throw error;
        }
      }
    } finally {
      reader.releaseLock?.();
    }
  } else if (isAsyncIterable(body)) {
    for await (const value of body) append(value);
  } else if (typeof request.arrayBuffer === 'function') {
    append(await request.arrayBuffer());
  } else {
    throw new TypeError('当前运行时无法读取请求正文');
  }

  if (total === 0) throw new HttpError(400, '上传内容为空');
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
