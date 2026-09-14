import { MAX_CONTAINER_BYTES } from './constants.js';

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

  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, '只允许从本站上传回放');
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONTAINER_BYTES) {
    throw new HttpError(413, '压缩后的回放超过 256 KiB');
  }
}

export async function readLimitedBody(request: Request) {
  if (!request.body) throw new HttpError(400, '上传内容为空');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CONTAINER_BYTES) {
        await reader.cancel();
        throw new HttpError(413, '压缩后的回放超过 256 KiB');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
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
