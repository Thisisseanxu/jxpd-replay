<template>
  <main class="shared-shell">
    <div class="shared-card panel">
      <div class="shared-brand">
        <Star size="18" fill="currentColor" /> 吉星派对 Replay Lab
      </div>

      <div v-if="loading" class="shared-state">
        <div class="loader" />
        <h1>正在安全读取回放</h1>
        <p>{{ status }}</p>
      </div>

      <div v-else-if="error" class="shared-state error-state">
        <Caution size="38" fill="currentColor" />
        <h1>无法打开这个回放</h1>
        <p>{{ error }}</p>
        <button type="button" @click="$emit('back')">返回分享页</button>
      </div>

      <template v-else-if="analysis">
        <div class="ready-heading">
          <div>
            <h1>点击下载分享的回放</h1>
          </div>
        </div>

        <div class="shared-stats">
          <div>
            <span>文件大小</span><b>{{ formatBytes(analysis.size) }}</b>
          </div>
          <div>
            <span>有效期至</span><b>{{ expiryLabel }}</b>
          </div>
        </div>

        <div class="shared-players">
          <div
            v-for="(player, index) in analysis.players"
            :key="player.id.toString()"
          >
            <span>{{ index + 1 }}</span>
            <b>{{ player.originalName || player.label }}</b>
          </div>
        </div>

        <section class="download-menu" aria-labelledby="download-menu-title">
          <div class="download-menu-heading">
            <strong id="download-menu-title">下载设置</strong>
            <span>下载前可以自定义文件名</span>
          </div>
          <label class="download-name-field">
            <span>文件名</span>
            <input
              :value="downloadName"
              type="text"
              aria-label="下载文件名"
              @input="onDownloadNameInput"
            />
          </label>
          <label class="toggle-row" for="shared-download-zip">
            <span class="toggle-copy"
              ><b>下载 ZIP 压缩包</b
              ><small>内部为同名文件夹和回放文件</small></span
            >
            <input
              id="shared-download-zip"
              type="checkbox"
              :checked="zipDownload"
              @change="onZipDownloadChange"
            />
            <span class="toggle-ui" />
          </label>
        </section>

        <button type="button" class="download-button" @click="onDownload">
          <Download size="19" fill="currentColor" />
          {{ zipDownload ? "下载 ZIP 压缩包" : "下载回放文件" }}
        </button>
        <button type="button" class="back-button" @click="$emit('back')">
          我也要分享
        </button>
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Caution, Download, Star } from "@icon-park/vue-next";
import { formatBytes } from "../utils/replay";
import type { ReplayAnalysis } from "../utils/replay";
import type { ReplayPrivacyMode } from "../utils/replay-container";
import type { ReplayDownloadOptions } from "../utils/replay-download";

const props = defineProps<{
  loading: boolean;
  status: string;
  error: string;
  analysis: ReplayAnalysis | null;
  privacyMode: ReplayPrivacyMode | null;
  expiresAt: string;
  defaultDownloadName: string;
}>();

const emit = defineEmits<{
  download: [options: ReplayDownloadOptions];
  back: [];
}>();

const downloadName = ref(props.defaultDownloadName);
const zipDownload = ref(true);

watch(
  () => props.defaultDownloadName,
  (value) => {
    downloadName.value = value;
    zipDownload.value = true;
  },
);

function onDownloadNameInput(event: Event) {
  downloadName.value = (event.target as HTMLInputElement).value;
}

function onZipDownloadChange(event: Event) {
  zipDownload.value = (event.target as HTMLInputElement).checked;
}

function onDownload() {
  emit("download", {
    fileName: downloadName.value,
    zip: zipDownload.value,
  });
}

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
  padding: clamp(20px, 5vw, 32px);
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
  margin: 0 0 7px;
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
  to {
    transform: rotate(360deg);
  }
}
.error-state {
  color: #ff9db0;
}
.error-state button,
.back-button {
  padding: 10px 14px;
  border: 1px solid var(--line-bright);
  border-radius: 10px;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.04);
}
.ready-heading {
  display: flex;
  gap: 16px;
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
.download-menu {
  display: grid;
  gap: 14px;
  margin-top: 23px;
  padding: 15px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(9, 5, 21, 0.27);
}
.download-menu-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.download-menu-heading strong {
  color: var(--ink);
  font-size: 13px;
}
.download-menu-heading span,
.download-name-field > span {
  color: var(--muted);
  font-size: 12px;
}
.download-name-field {
  display: grid;
  gap: 8px;
}
.download-name-field input {
  width: 100%;
  padding: 10px 11px;
  border: 1px solid rgba(193, 160, 255, 0.18);
  border-radius: 9px;
  color: var(--ink);
  background: rgba(10, 6, 24, 0.42);
  font-size: 13px;
  outline: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}
.download-name-field input:focus {
  border-color: var(--purple);
  box-shadow: 0 0 0 3px rgba(169, 108, 255, 0.12);
}
.toggle-row {
  display: flex;
  align-items: center;
  gap: 11px;
  cursor: pointer;
}
.toggle-copy {
  display: grid;
  gap: 4px;
  flex: 1;
}
.toggle-copy b {
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
}
.toggle-copy small {
  color: var(--muted);
  font-size: 12px;
}
.toggle-row input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.toggle-ui {
  position: relative;
  flex: none;
  width: 39px;
  height: 22px;
  border-radius: 999px;
  background: #3b2c55;
  transition: 0.18s ease;
}
.toggle-ui::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #9987ad;
  transition: 0.18s ease;
}
.toggle-row input:checked + .toggle-ui {
  background: var(--purple);
}
.toggle-row input:checked + .toggle-ui::after {
  left: 20px;
  background: #fff;
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
  margin: 0 auto 0;
  border: 0;
  background: transparent;
  color: var(--muted);
}
</style>
