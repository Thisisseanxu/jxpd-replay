import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { anonymizeReplay, inspectReplay } from '../src/utils/replay';
import { validateContainer } from '../cloud-functions/_shared/replay-validation';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import {
  packReplayLossless,
  unpackReplayLossless,
} from '../cloud-functions/_shared/replay-pack';

const fixturePaths = (process.env.JXPD_PRIVATE_REPLAYS || '')
  .split(';')
  .map((value) => value.trim())
  .filter(Boolean);

function makeContainer(replay: Uint8Array, privacy: number) {
  const packed = packReplayLossless(replay);
  const compressed = brotliCompressSync(packed, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const output = new Uint8Array(47 + compressed.length);
  output.set(Buffer.from('JXRS'));
  output[4] = 1;
  output[5] = 1;
  output[6] = privacy;
  new DataView(output.buffer).setUint32(7, replay.length, false);
  new DataView(output.buffer).setUint32(11, packed.length, false);
  output.set(createHash('sha256').update(replay).digest(), 15);
  output.set(compressed, 47);
  return output;
}

describe.skipIf(fixturePaths.length === 0)('private replay regression', () => {
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
        expect(container.length).toBeLessThanOrEqual(256 * 1024);
        expect(validateContainer(container).originalBytes).toBe(
          mode.bytes.length,
        );
        const packed = brotliDecompressSync(container.subarray(47));
        const restored = unpackReplayLossless(packed, mode.bytes.length);
        expect(createHash('sha256').update(restored).digest('hex')).toBe(
          createHash('sha256').update(mode.bytes).digest('hex'),
        );
      }
    }, 60_000);
  }
});
