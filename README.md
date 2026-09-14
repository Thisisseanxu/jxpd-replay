# 吉星派对 Replay Lab

在浏览器本地分析、匿名化并安全分享吉星派对回放。原有本地导出功能保持不变；分享功能会先在 Web Worker 中用 Brotli quality 11 压缩，服务端校验后写入私有 EdgeOne Blob。

## 本地开发

```powershell
npm install
npm run dev
```

常用检查：

```powershell
npm run typecheck
npm test
npm run build
```

未配置 EdgeOne Blob 凭据时，本地页面的分析、匿名化和下载仍可使用；分享 API 需要通过 `edgeone makers dev` 或已部署的 Makers 项目运行。

## 分享功能

- 匿名分享默认保存 7 天，无需注册。
- 有效邀请码可选择保存 90 天。
- 分享凭证只出现在 URL fragment（`/#/r/<capability>`）中，下载时通过 `Authorization: Replay ...` 发送。
- Blob 对象不公开，上传和下载都经过 Node.js Cloud Functions。
- 单个 JXRS 容器不超过 80 KiB，解压后的标准回放不超过 8 MiB。
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

测试会检查原始、完全匿名、自定义保留三种模式都不超过 80 KiB，并验证服务端解析及逐字节 SHA-256 恢复。
