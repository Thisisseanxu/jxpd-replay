# 吉星派对 Replay Lab

在浏览器本地分析、匿名化并安全分享吉星派对回放。原有本地导出功能保持不变；分享功能会先在 Web Worker 中无损重排回放帧，再用 Brotli quality 11 压缩，服务端还原并校验后写入私有 EdgeOne Blob。

## 本地开发

```powershell
npm install
npm run dev
```

`npm run dev` 会在 `.local-blob/` 中启用文件型 Blob，实现完整的本地分享、
刷新后读取和额度逻辑，不需要 EdgeOne 账号或网络连接。要清空本地分享数据，
停止开发服务器后删除 `.local-blob/` 即可。

如需联调真实 EdgeOne Blob，请先关联 Makers 项目，再启动平台开发服务器：

```powershell
edgeone makers link
edgeone makers dev
```

`edgeone.json` 会让该命令使用 `npm run dev:edgeone`，因此不会加载文件型 Store；
Functions 中的 `@edgeone/pages-blob` 将连接关联项目的真实 Blob。

常用检查：

```powershell
npm run typecheck
npm test
npm run build
```

文件型 Store 仅用于开发，生产构建和已部署的 Makers 项目始终使用真实 Blob。

## 路由与 SSG

- `App.vue` 只负责全局壳层（路由出口、更新提示和页面 head），实际页面由 `src/router.ts` 控制。
- `/` 和 `/share` 使用 `vite-ssg` 预渲染为 `dist/index.html` 与 `dist/share/index.html`，路由 `meta.title`、描述、robots、Open Graph 和 canonical 会写入各自 HTML。
- `spa.html` 是非预渲染路由使用的 SPA 入口；运行 `npm run build:verify` 可检查 SSG 页面及页面 head。

## 分享功能

- 匿名分享默认保存 7 天，无需注册。
- 有效邀请码可选择保存 90 天。
- 分享创建页位于 `/share`，生成的链接为 `/share#/r/<capability>`；凭证只出现在 URL fragment 中，下载时通过 `Authorization: Replay ...` 发送。
- 匿名化工具的圆形分享按钮会把当前匿名副本直接交给 `/share`，无需重新选择文件；分享页也会提示未匿名文件并提供跳转入口。
- 分享记录下载时可自定义默认填充的文件名；ZIP 开关默认开启，压缩包内为同名文件夹和同名回放文件。
- Blob 对象不公开，上传和下载都经过 Node.js Cloud Functions。
- 单个 JXRS 容器不超过 256 KiB，解压后的标准回放不超过 8 MiB。
- 下载端在本机解压并验证 SHA-256，先显示概览，再恢复标准回放文件。
- 分享链接不可提前撤销；任何持链者都能读取，过期后立即返回 `410`。

部署、安全配置、邀请码和容器格式见 [docs/replay-sharing.md](docs/replay-sharing.md)。

## 私有回归样本

仓库不会保存真实回放。需要在本机复验多个样本时，把路径用分号分隔后运行：

```powershell
$env:JXPD_PRIVATE_REPLAYS='D:\private\replay-a;D:\private\replay-b'
npm test
Remove-Item Env:JXPD_PRIVATE_REPLAYS
```

测试会检查原始、完全匿名、自定义保留三种模式都不超过 256 KiB，并验证服务端解析及逐字节 SHA-256 恢复。
