import { createHmac } from "node:crypto";

const pepper = process.env.REPLAY_INVITE_PEPPER || "";
const code = process.env.REPLAY_INVITE_CODE || "";
const id = process.env.REPLAY_INVITE_ID || "trusted";

if (pepper.length < 24 || !code || !/^[A-Za-z0-9_-]{1,48}$/.test(id)) {
  console.error(
    "请设置 REPLAY_INVITE_PEPPER（至少 24 字符）、REPLAY_INVITE_CODE 和合法的 REPLAY_INVITE_ID。",
  );
  process.exitCode = 1;
} else {
  const digest = createHmac("sha256", pepper).update(code.trim()).digest("hex");
  console.log(JSON.stringify([{ id, digest, retentionDays: 90 }]));
}
