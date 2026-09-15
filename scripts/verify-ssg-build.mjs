import { readFile } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve("dist");
const errors = [];

async function read(relativePath) {
  try {
    return await readFile(path.join(dist, relativePath), "utf8");
  } catch {
    errors.push(`缺少构建产物：${relativePath}`);
    return "";
  }
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

const pages = [
  ["index.html", "吉星派对 · 回放匿名化与分享"],
  ["share/index.html", "分享回放 | 吉星派对 Replay Lab"],
  ["code/index.html", "输入分享码 | 吉星派对 Replay Lab"],
];

for (const [relativePath, expectedTitle] of pages) {
  const html = await read(relativePath);
  assert(
    html.includes('data-server-rendered="true"'),
    `页面未完成 SSR：${relativePath}`,
  );
  assert(
    (html.match(/<title>[\s\S]*?<\/title>/g) || []).length === 1,
    `title 数量异常：${relativePath}`,
  );
  assert(
    html.includes(`<title>${expectedTitle}</title>`),
    `页面标题不正确：${relativePath}`,
  );
  assert(
    (html.match(/<meta[^>]+name="description"[^>]*>/g) || []).length === 1,
    `description 数量异常：${relativePath}`,
  );
  assert(
    (html.match(/<link[^>]+rel="canonical"[^>]*>/g) || []).length === 1,
    `canonical 数量异常：${relativePath}`,
  );
}

const spa = await read("spa.html");
assert(!spa.includes('data-server-rendered="true"'), "spa.html 不应包含 SSR 内容");
assert(
  /<meta[^>]+name="robots"[^>]+content="noindex, nofollow"/.test(spa),
  "spa.html 缺少 noindex, nofollow",
);

if (errors.length) {
  console.error(`SSG 产物验证失败（${errors.length} 项）：`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log("SSG 产物验证通过：3 个预渲染页面，1 个 SPA 壳页面。");
