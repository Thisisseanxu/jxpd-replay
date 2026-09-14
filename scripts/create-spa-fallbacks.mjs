import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve("dist");
const spaShell = path.join(dist, "spa.html");
// 当前需要公开访问的页面都由 vite-ssg 直接产出；保留脚本以便后续
// 增加明确的 SPA-only 路由时，可以沿用参考项目的回退页流程。
const spaRoutes = [];

for (const route of spaRoutes) {
  const directory = path.join(dist, route.slice(1));
  await mkdir(directory, { recursive: true });
  await copyFile(spaShell, path.join(directory, "index.html"));
}

console.log(`已生成 ${spaRoutes.length} 个 SPA 路由空壳。`);
