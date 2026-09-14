export const MAX_CONTAINER_BYTES = 80 * 1024;
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;
export const MAX_REPLAY_FRAMES = 100_000;
export const CONTAINER_HEADER_BYTES = 43;
export const DATA_STORE_NAME = "replay-data";
export const CONTROL_STORE_NAME = "replay-control";
export const DEVICE_COOKIE_NAME = "__Host-jxpd_device";

export type PrivacyMode = "original" | "anonymous" | "custom";

export type FunctionContext = {
  request: Request;
  params?: Record<string, string>;
  env?: Record<string, string | undefined>;
  clientIp?: string;
  uuid?: string;
};
