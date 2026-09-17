import { rm } from 'node:fs/promises';
import path from 'node:path';

const fixturePaths = (process.env.JXPD_PRIVATE_REPLAYS || '')
  .split(';')
  .map((value) => value.trim())
  .filter(Boolean);

const localBlobRoot = path.resolve('.local-blob');

if (fixturePaths.length === 0) {
  await rm(localBlobRoot, { recursive: true, force: true });
  console.log('已清空本地 Blob 环境。');
} else {
  console.log(
    `检测到 ${fixturePaths.length} 个私有回归样本，保留本地 Blob 环境。`,
  );
}
