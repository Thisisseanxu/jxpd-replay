# 回放分享部署与安全说明

## 架构

浏览器先按用户选择保留原始内容，或复用现有匿名化流程生成新标准回放；随后在 Web Worker 中延迟加载 `brotli-wasm`，以 quality 11 压缩并封装成 JXRS v1。`POST /api/replays` 流式限制请求体、解压并校验，再写入 `replay-data`。额度占位、清理锁等控制对象写入 `replay-control`。

Blob 不使用预签名直传，因为预签名 PUT 不能约束最终字节数，也不能在写入前验证回放结构。两个 Blob 命名空间只由 Functions SDK 访问，浏览器不持有 Blob Token。Blob SDK 会在首次使用命名空间时创建它。

## EdgeOne Makers 部署

项目根目录的 `edgeone.json` 已配置：

- `npm ci`、`npm run build` 和 `dist` 输出目录；
- Node.js Cloud Functions 最长执行 120 秒；
- 每天 `03:15 Asia/Shanghai` 触发 `/api/internal/replay-cleanup`；
- CSP、禁止 iframe、`nosniff`、无 Referrer 等静态安全响应头。

在 EdgeOne Makers 控制台为项目配置以下加密环境变量：

| 变量 | 用途 |
| --- | --- |
| `REPLAY_QUOTA_SECRET` | 每日轮换的 IP、设备额度标识 HMAC；至少 24 个随机字符 |
| `REPLAY_DEVICE_SECRET` | 签名 `__Host-jxpd_device` HttpOnly Cookie；至少 24 个随机字符 |
| `REPLAY_INVITE_PEPPER` | 邀请码 HMAC pepper；至少 24 个随机字符 |
| `REPLAY_INVITES_JSON` | 邀请组数组，只保存组 ID、HMAC 摘要与 90 天策略 |

可以用 Node.js 生成三个独立的 32-byte secret：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

不要把真实 `.env`、邀请码、pepper 或 Blob API Token 提交到仓库。

### 生成邀请码摘要

```powershell
$env:REPLAY_INVITE_PEPPER='与控制台完全相同的 pepper'
$env:REPLAY_INVITE_CODE='发给指定用户组的邀请码'
$env:REPLAY_INVITE_ID='supporters-2026'
npm run invite:hash
Remove-Item Env:REPLAY_INVITE_CODE
```

把输出的 JSON 整体写入 `REPLAY_INVITES_JSON`。服务端会重新计算 HMAC-SHA-256，并对摘要做常量时间比较；明文邀请码不会写入 Blob 或日志。

### EdgeOne 安全规则（控制台配置）

`edgeone.json` 不负责站点 Web 防护策略。部署后在 EdgeOne 控制台配置一条“精准速率限制”：

- 匹配：请求方法等于 `POST`，请求路径等于 `/api/replays`；
- 统计维度：客户端 IP；
- 周期与阈值：60 秒内 10 次；
- 处置：超过后拦截，并按实际流量选择合理的持续时间；
- 异常流量同时启用基础 Bot 管理或 JavaScript 挑战。

应用内还会执行强一致条件写额度：匿名每 IP 和每设备各 5 个/日、全站 500 个/日；邀请码组每 IP、设备、邀请码各 20 个/日、全站 50 个/日。无效回放会消耗主体额度，但只有通过完整校验的数据才占用全站有效上传额度。

按 80 KiB 上限估算，7 天匿名窗口与 90 天邀请窗口同时满载时约为 625 MiB，为免费 Blob 的 1 GB 容量、控制对象和清理延迟留有余量。

## JXRS v1

所有整数均为 big-endian：

| 偏移 | 长度 | 内容 |
| ---: | ---: | --- |
| 0 | 4 | ASCII `JXRS` |
| 4 | 1 | 容器版本 `1` |
| 5 | 1 | codec `1`（Brotli） |
| 6 | 1 | 隐私模式：`0` 原始、`1` 匿名、`2` 自定义 |
| 7 | 4 | 解压后标准回放长度 |
| 11 | 32 | 解压后内容 SHA-256 |
| 43 | 其余 | Brotli 数据 |

服务端先检查 `Content-Length`，再流式读取，达到第 81,921 字节时立即终止。Brotli 解压通过 Node.js `maxOutputLength` 限制为 8 MiB，并核对声明长度、SHA-256、6-byte 帧边界、protobuf wire 格式、最多 100,000 帧、房间快照和正常结束帧。未知 command ID 不会被拒绝。

## 存储键、读取与清理

能力令牌由版本、到期秒时间戳和 192-bit 随机值组成。Blob 键不保存原始令牌，而是：

```text
v1/exp=YYYY-MM-DD/<2-char shard>/<SHA-256(capability)>
```

读取接口只接受 `Authorization: Replay <capability>`，使用强一致 Blob 读取，并返回 `Cache-Control: no-store`。到期判断先于 Blob 访问，因此已过期令牌立即得到 `410`；有效但不存在是 `404`。

清理任务只比较服务器计算的当前日期，不接受日期或前缀请求参数。它按到期目录分页删除，单次最多 2,000 个对象；条件锁使同一天重复调用幂等。若达到预算或 Blob 暂时失败，锁会释放，下次调用从剩余对象继续。即使物理删除延迟，下载接口也会严格执行令牌中的秒级过期时间。

参考：[Blob](https://cloud.tencent.com/document/product/1552/131425)、[Node.js Cloud Functions](https://pages.edgeone.ai/document/node-functions)、[edgeone.json](https://pages.edgeone.ai/document/edgeone-json)、[精准速率限制](https://cloud.tencent.com/document/product/1552/93130)。
