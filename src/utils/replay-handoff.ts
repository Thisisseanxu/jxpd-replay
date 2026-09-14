import { MAX_REPLAY_OUTPUT_BYTES } from "./replay-container";
import type { ReplayPrivacyMode } from "./replay-container";

export type ReplayHandoffTarget = "share" | "anonymizer";

export type ReplayHandoff = {
  fileName: string;
  bytes: Uint8Array;
  privacyMode: ReplayPrivacyMode | null;
};

type StoredReplayHandoff = {
  id: string;
  target: ReplayHandoffTarget;
  fileName: string;
  bytes: ArrayBuffer;
  privacyMode: ReplayPrivacyMode | null;
  createdAt: number;
};

const DATABASE_NAME = "jxpd-replay-handoff";
const STORE_NAME = "pending";
const DATABASE_VERSION = 1;
const RECORD_ID = "pending";
const HANDOFF_TTL_MS = 5 * 60 * 1000;

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    throw new Error("当前浏览器不支持跨页面文件传递");
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开临时文件存储"));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("临时文件存储失败"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error || new Error("临时文件存储事务被中止"));
    transaction.onerror = () =>
      reject(transaction.error || new Error("临时文件存储事务失败"));
  });
}

export async function putReplayHandoff(
  target: ReplayHandoffTarget,
  bytes: Uint8Array,
  fileName: string,
  privacyMode: ReplayPrivacyMode | null = null,
) {
  if (bytes.length === 0 || bytes.length > MAX_REPLAY_OUTPUT_BYTES) {
    throw new Error("跨页面传递的回放大小无效");
  }

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      id: RECORD_ID,
      target,
      fileName: fileName.trim() || "replay",
      bytes: bytes.slice().buffer as ArrayBuffer,
      privacyMode,
      createdAt: Date.now(),
    } satisfies StoredReplayHandoff);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function takeReplayHandoff(target: ReplayHandoffTarget) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const record = await requestResult<StoredReplayHandoff | undefined>(
      store.get(RECORD_ID),
    );

    if (!record) {
      await transactionDone(transaction);
      return null;
    }

    if (Date.now() - record.createdAt > HANDOFF_TTL_MS) {
      store.delete(RECORD_ID);
      await transactionDone(transaction);
      return null;
    }

    if (record.target !== target) {
      await transactionDone(transaction);
      return null;
    }

    store.delete(RECORD_ID);
    await transactionDone(transaction);
    return {
      fileName: record.fileName,
      bytes: new Uint8Array(record.bytes),
      privacyMode: record.privacyMode,
    } satisfies ReplayHandoff;
  } finally {
    database.close();
  }
}
