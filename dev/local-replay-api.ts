import type {
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  CONTROL_STORE_NAME,
  DATA_STORE_NAME,
  MAX_CONTAINER_BYTES,
  type FunctionContext,
} from '../cloud-functions/_shared/constants';
import { jsonResponse } from '../cloud-functions/_shared/http';
import { replayContentResponse } from '../cloud-functions/api/replays/content';
import { replayCodeResponse } from '../cloud-functions/api/replays/code';
import { replayUploadResponse } from '../cloud-functions/api/replays/index';
import { LocalFileStore } from './local-file-store';

type LocalReplayApiOptions = {
  rootDirectory: string;
  env: Record<string, string | undefined>;
};

const localDefaults = {
  REPLAY_QUOTA_SECRET: 'local-dev-quota-secret-do-not-use-in-production',
  REPLAY_DEVICE_SECRET: 'local-dev-device-secret-do-not-use-in-production',
  REPLAY_INVITE_PEPPER: 'local-dev-invite-pepper-do-not-use-in-production',
  REPLAY_INVITES_JSON: '[]',
};

function requestHeaders(headers: IncomingHttpHeaders) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item);
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}

async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > MAX_CONTAINER_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function fetchRequest(request: IncomingMessage) {
  const host = request.headers.host || 'localhost';
  const url = new URL(request.url || '/', `http://${host}`);
  const method = request.method || 'GET';
  const body =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : await requestBody(request);
  if (body === null) return null;
  return new Request(url, {
    method,
    headers: requestHeaders(request.headers),
    body,
  });
}

async function sendResponse(response: Response, target: ServerResponse) {
  target.statusCode = response.status;
  target.statusMessage = response.statusText;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  target.end(Buffer.from(await response.arrayBuffer()));
}

function methodNotAllowed(allowed: string) {
  return jsonResponse({ error: '请求方法不受支持' }, 405, { Allow: allowed });
}

export function localReplayApiPlugin(options: LocalReplayApiOptions): Plugin {
  const storageRoot = path.join(options.rootDirectory, '.local-blob');
  const data = new LocalFileStore(
    storageRoot,
    DATA_STORE_NAME,
  ).asEdgeOneStore();
  const control = new LocalFileStore(
    storageRoot,
    CONTROL_STORE_NAME,
  ).asEdgeOneStore();
  const factory = (name: string) => {
    if (name === DATA_STORE_NAME) return data;
    if (name === CONTROL_STORE_NAME) return control;
    throw new Error(`Unknown local Blob store: ${name}`);
  };
  const env = { ...localDefaults, ...options.env };

  return {
    name: 'jxpd-local-replay-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (incoming, outgoing, next) => {
        try {
          const pathname = new URL(
            incoming.url || '/',
            `http://${incoming.headers.host || 'localhost'}`,
          ).pathname;
          const isUpload = pathname === '/api/replays';
          const isContent = pathname === '/api/replays/content';
          const isCode = pathname === '/api/replays/code';
          if (!isUpload && !isContent && !isCode) return next();

          if (isUpload && incoming.method !== 'POST') {
            await sendResponse(methodNotAllowed('POST'), outgoing);
            return;
          }
          if (isContent && incoming.method !== 'GET') {
            await sendResponse(methodNotAllowed('GET'), outgoing);
            return;
          }
          if (isCode && incoming.method !== 'GET') {
            await sendResponse(methodNotAllowed('GET'), outgoing);
            return;
          }

          const request = await fetchRequest(incoming);
          if (!request) {
            await sendResponse(
              jsonResponse({ error: '压缩后的回放超过 256 KiB' }, 413),
              outgoing,
            );
            return;
          }

          const context: FunctionContext = {
            request,
            clientIp: incoming.socket.remoteAddress || 'local-development',
            env,
          };
          const response = isUpload
            ? await replayUploadResponse(context, factory)
            : isContent
              ? await replayContentResponse(
                  request,
                  data,
                  Math.floor(Date.now() / 1000),
                  control,
                )
              : await replayCodeResponse(request, control);
          await sendResponse(response, outgoing);
        } catch (error) {
          server.config.logger.error(
            `Local replay API failed: ${error instanceof Error ? error.stack : String(error)}`,
          );
          if (!outgoing.headersSent) {
            await sendResponse(
              jsonResponse({ error: '本地分享服务暂时不可用' }, 500),
              outgoing,
            );
          } else {
            outgoing.end();
          }
        }
      });
    },
  };
}
