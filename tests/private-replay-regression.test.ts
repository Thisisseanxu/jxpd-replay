import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { anonymizeReplay, inspectReplay } from "../src/utils/replay";
import { validateContainer } from "../cloud-functions/_shared/replay-validation";
import { createHash } from "node:crypto";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

const fixturePaths = (process.env.JXPD_PRIVATE_REPLAYS || "")
  .split(";")
  .map((value) => value.trim())
  .filter(Boolean);

function makeContainer(replay: Uint8Array, privacy: number) {
  const compressed = brotliCompressSync(replay, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const output = new Uint8Array(43 + compressed.length);
  output.set(Buffer.from("JXRS"));
  output[4] = 1;
  output[5] = 1;
  output[6] = privacy;
  new DataView(output.buffer).setUint32(7, replay.length, false);
  output.set(createHash("sha256").update(replay).digest(), 11);
  output.set(compressed, 43);
  return output;
}

describe.skipIf(fixturePaths.length === 0)("private replay regression", () => {
  for (const [fixtureIndex, fixturePath] of fixturePaths.entries()) {
    it(`round-trips all privacy modes for local fixture ${fixtureIndex + 1}`, () => {
      const source = new Uint8Array(readFileSync(fixturePath));
      const analysis = inspectReplay(source);
      const modes = [
        { privacy: 0, bytes: source },
        {
          privacy: 1,
          bytes: anonymizeReplay(analysis, new Set(), false).bytes,
        },
        {
          privacy: 2,
          bytes: anonymizeReplay(analysis, new Set([1]), true).bytes,
        },
      ];

      for (const mode of modes) {
        const container = makeContainer(mode.bytes, mode.privacy);
        expect(container.length).toBeLessThanOrEqual(80 * 1024);
        expect(validateContainer(container).originalBytes).toBe(mode.bytes.length);
        const restored = brotliDecompressSync(container.subarray(43));
        expect(createHash("sha256").update(restored).digest("hex")).toBe(
          createHash("sha256").update(mode.bytes).digest("hex"),
        );
      }
    }, 60_000);
  }
});
