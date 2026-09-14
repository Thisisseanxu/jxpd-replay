<template>
  <main class="shared-shell">
    <div class="shared-card panel">
      <div class="shared-brand"><Star size="18" fill="currentColor" /> 吉星派对 Replay Lab</div>

      <div v-if="loading" class="shared-state">
        <div class="loader" />
        <h1>正在安全读取回放</h1>
        <p>{{ status }}</p>
      </div>

      <div v-else-if="error" class="shared-state error-state">
        <Caution size="38" fill="currentColor" />
        <h1>无法打开这个回放</h1>
        <p>{{ error }}</p>
        <button type="button" @click="$emit('back')">返回回放工具</button>
      </div>

      <template v-else-if="analysis">
        <div class="ready-heading">
          <div class="ready-icon"><Check size="25" fill="currentColor" /></div>
          <div>
            <span>{{ privacyLabel }}</span>
            <h1>回放已准备好</h1>
            <p>内容已在本机解压并通过完整性校验。</p>
          </div>
        </div>

        <div class="shared-stats">
          <div><span>房间</span><b>{{ analysis.roomName || "未命名房间" }}</b></div>
          <div><span>回放帧</span><b>{{ analysis.frameCount.toLocaleString() }}</b></div>
          <div><span>文件大小</span><b>{{ formatBytes(analysis.size) }}</b></div>
          <div><span>有效期至</span><b>{{ expiryLabel }}</b></div>
        </div>

        <div class="shared-players">
          <div v-for="(player, index) in analysis.players" :key="player.id.toString()">
            <span>{{ index + 1 }}</span>
            <b>{{ player.originalName || player.label }}</b>
          </div>
        </div>

        <button type="button" class="download-button" @click="$emit('download')">
          <Download size="19" fill="currentColor" /> 下载标准回放文件
        </button>
        <button type="button" class="back-button" @click="$emit('back')">打开回放工具</button>
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Caution, Check, Download, Star } from "@icon-park/vue-next";
import { formatBytes } from "../utils/replay";
import type { ReplayAnalysis } from "../utils/replay";
import type { ReplayPrivacyMode } from "../utils/replay-container";

const props = defineProps<{
  loading: boolean;
  status: string;
  error: string;
  analysis: ReplayAnalysis | null;
  privacyMode: ReplayPrivacyMode | null;
  expiresAt: string;
}>();

defineEmits<{ download: []; back: [] }>();

const privacyLabel = computed(() => {
  if (props.privacyMode === "original") return "原始内容 · 可能包含玩家信息";
  if (props.privacyMode === "custom") return "自定义匿名设置";
  return "已匿名化";
});

const expiryLabel = computed(() =>
  props.expiresAt
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(props.expiresAt))
    : "—",
);
</script>

<style scoped>
.shared-shell {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: 24px;
  background:
    radial-gradient(circle at 50% 0, rgba(135, 65, 219, 0.28), transparent 43%),
    #0f0a1d;
}
.shared-card {
  width: min(680px, 100%);
  padding: clamp(24px, 5vw, 42px);
}
.shared-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--gold);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.shared-state {
  display: grid;
  justify-items: center;
  min-height: 360px;
  align-content: center;
  text-align: center;
}
.shared-state h1,
.ready-heading h1 {
  margin: 18px 0 7px;
  font-size: clamp(27px, 5vw, 38px);
  letter-spacing: -0.04em;
}
.shared-state p,
.ready-heading p {
  margin: 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.65;
}
.loader {
  width: 42px;
  height: 42px;
  border: 3px solid rgba(169, 108, 255, 0.2);
  border-top-color: var(--purple);
  border-radius: 50%;
  animation: spin 0.85s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.error-state {
  color: #ff9db0;
}
.error-state button,
.back-button {
  margin-top: 22px;
  padding: 10px 14px;
  border: 1px solid var(--line-bright);
  border-radius: 10px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.04);
}
.ready-heading {
  display: flex;
  gap: 16px;
  margin-top: 42px;
}
.ready-heading h1 {
  margin-top: 6px;
}
.ready-heading span {
  color: var(--green);
  font-size: 13px;
  font-weight: 700;
}
.ready-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 48px;
  height: 48px;
  border-radius: 15px;
  color: #10251f;
  background: var(--green);
}
.shared-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
  margin-top: 30px;
}
.shared-stats > div {
  min-width: 0;
  padding: 13px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: rgba(9, 5, 21, 0.27);
}
.shared-stats span {
  display: block;
  color: var(--muted);
  font-size: 12px;
}
.shared-stats b {
  display: block;
  overflow: hidden;
  margin-top: 5px;
  color: var(--ink);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shared-players {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}
.shared-players div {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border-radius: 9px;
  color: var(--muted);
  background: rgba(169, 108, 255, 0.08);
  font-size: 12px;
}
.shared-players span {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 7px;
  color: #21112c;
  background: var(--purple-bright);
  font-weight: 800;
}
.shared-players b {
  color: var(--ink);
}
.download-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 28px;
  padding: 14px;
  border: 0;
  border-radius: 11px;
  color: #21112c;
  background: linear-gradient(110deg, #d6a5ff, #ef83c1 58%, #f4c66c);
  font-size: 14px;
  font-weight: 800;
}
.back-button {
  display: block;
  margin: 11px auto 0;
  border: 0;
  background: transparent;
  color: var(--muted);
}

@media (max-width: 520px) {
  .shared-shell { padding: 14px; }
  .shared-card { padding: 22px 18px; }
  .ready-heading { align-items: flex-start; margin-top: 30px; }
  .shared-stats { grid-template-columns: 1fr; }
}
</style>
