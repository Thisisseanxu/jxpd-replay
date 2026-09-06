# 吉星派对 Replay Lab

一个静态 Vite 页面，用于在浏览器本地分析并匿名化吉星派对回放。

## 使用

```powershell
npm install
npm run dev
```

生产构建：

```powershell
npm run build
npm run start
```

也可以把 `dist/` 部署到任意静态文件服务器。处理过程不上传回放文件。

## 当前策略

- 回放文件在浏览器端解析，支持 6-byte frame header + protobuf payload。
- 玩家昵称默认匿名化为 `Player1`–`Player4`，可多选保留真实昵称
