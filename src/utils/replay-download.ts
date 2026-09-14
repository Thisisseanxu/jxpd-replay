import { zipSync } from "fflate";

export type ReplayDownloadOptions = {
  fileName: string;
  zip: boolean;
};

export type ReplayDownloadPayload = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
};

export function defaultSharedReplayName(capability: string) {
  return `jxpd-replay-${capability.slice(-8)}`;
}

export function normalizeDownloadName(value: string, fallback = "replay") {
  const candidate = value.trim() || fallback.trim() || "replay";
  const safeName = candidate
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
    .join("")
    .replace(/[. ]+$/g, "");
  return safeName || "replay";
}

export function createReplayDownload(
  bytes: Uint8Array,
  options: ReplayDownloadOptions,
  fallbackName = "replay",
): ReplayDownloadPayload {
  const fileName = normalizeDownloadName(options.fileName, fallbackName);
  if (!options.zip) {
    return {
      bytes: bytes.slice(),
      fileName,
      mimeType: "application/octet-stream",
    };
  }

  return {
    bytes: zipSync({ [`${fileName}/${fileName}`]: bytes }),
    fileName: `${fileName}.zip`,
    mimeType: "application/zip",
  };
}
