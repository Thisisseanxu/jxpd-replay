/// <reference lib="webworker" />

import brotliPromise from "brotli-wasm";
import {
  createReplayContainer,
  MAX_REPLAY_OUTPUT_BYTES,
  parseReplayContainer,
  verifyReplayContainerOutput,
} from "../utils/replay-container";
import type { ReplayPrivacyMode } from "../utils/replay-container";

type CodecRequest =
  | {
      id: number;
      operation: "encode";
      bytes: ArrayBuffer;
      privacyMode: ReplayPrivacyMode;
    }
  | { id: number; operation: "decode"; bytes: ArrayBuffer };

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

function decompressLimited(
  brotli: Awaited<typeof brotliPromise>,
  compressed: Uint8Array,
  expectedLength: number,
) {
  const stream = new brotli.DecompressStream();
  const output = new Uint8Array(expectedLength);
  let inputOffset = 0;
  let outputOffset = 0;
  let iterations = 0;
  try {
    while (iterations++ < 10_000) {
      const result = stream.decompress(compressed.subarray(inputOffset), 64 * 1024);
      inputOffset += result.input_offset;
      if (outputOffset + result.buf.length > output.length) {
        throw new Error("回放解压后超过声明长度或 8 MiB 安全上限");
      }
      output.set(result.buf, outputOffset);
      outputOffset += result.buf.length;
      if (result.code === brotli.BrotliStreamResultCode.ResultSuccess) break;
      if (result.code !== brotli.BrotliStreamResultCode.NeedsMoreOutput) {
        throw new Error("Brotli 回放数据被截断");
      }
      if (result.input_offset === 0 && result.buf.length === 0) {
        throw new Error("Brotli 解压没有进展");
      }
    }
  } finally {
    stream.free();
  }
  if (iterations >= 10_000 || inputOffset !== compressed.length || outputOffset !== output.length) {
    throw new Error("Brotli 回放无法完整解压");
  }
  return output;
}

workerScope.onmessage = async (event: MessageEvent<CodecRequest>) => {
  const { id } = event.data;
  try {
    const brotli = await brotliPromise;
    if (event.data.operation === "encode") {
      const original = new Uint8Array(event.data.bytes);
      if (original.length === 0 || original.length > MAX_REPLAY_OUTPUT_BYTES) {
        throw new Error("回放原始大小必须在 1 B 到 8 MiB 之间");
      }
      const compressed = brotli.compress(original, { quality: 11 });
      const container = await createReplayContainer(
        original,
        compressed,
        event.data.privacyMode,
      );
      workerScope.postMessage(
        { id, ok: true, bytes: container.buffer },
        [container.buffer],
      );
      return;
    }

    const container = parseReplayContainer(new Uint8Array(event.data.bytes));
    const output = decompressLimited(
      brotli,
      container.compressed,
      container.originalLength,
    );
    await verifyReplayContainerOutput(container, output);
    workerScope.postMessage(
      {
        id,
        ok: true,
        bytes: output.buffer,
        privacyMode: container.privacyMode,
      },
      [output.buffer],
    );
  } catch (error) {
    workerScope.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : "回放压缩处理失败",
    });
  }
};

export {};
