<template>
  <section class="panel share-panel">
    <div class="panel-kicker"><span class="step-dot">02</span> 创建分享</div>

    <div class="share-block">
      <div class="share-label">保存时间</div>
      <div class="retention-row">
        <button
          type="button"
          :class="{ selected: retentionDays === 7 }"
          @click="$emit('update:retention-days', 7)"
        >
          7 天 <small>无需邀请码</small>
        </button>
        <button
          type="button"
          :class="{ selected: retentionDays === 90 }"
          @click="$emit('update:retention-days', 90)"
        >
          90 天 <small>需要邀请码</small>
        </button>
      </div>
      <input
        v-if="retentionDays === 90"
        class="invite-input"
        type="password"
        autocomplete="off"
        :value="inviteCode"
        placeholder="输入长期保存激活码"
        aria-label="长期保存激活码"
        @input="onInviteInput"
      />
    </div>

    <button
      type="button"
      class="share-button"
      :disabled="
        !canShare || busy || (retentionDays === 90 && !inviteCode.trim())
      "
      @click="$emit('share')"
    >
      <ShareOne size="18" fill="currentColor" />
      {{ busy ? "正在处理中…" : "生成分享链接" }}
    </button>

    <div v-if="error" class="share-error">{{ error }}</div>

    <div v-if="result" class="share-result">
      <div class="result-heading">
        <span><LinkOne size="16" fill="currentColor" /> 上传成功</span>
        <small>{{ formatExpiry(result.expiresAt) }} 过期</small>
      </div>
      <div class="link-row">
        <input :value="result.shareUrl" readonly aria-label="分享链接" />
        <button type="button" @click="copyLink">
          <Copy size="15" fill="currentColor" />
          {{ copied ? "已复制" : "复制" }}
        </button>
      </div>
      <p>任何拿到链接的人都能下载，请只发给可信对象。</p>
      <div class="share-result-grid" :class="{ 'has-qr': qrDataUrl }">
        <div v-if="qrDataUrl" class="qr-card">
          <img :src="qrDataUrl" alt="分享链接二维码" />
          <span>扫码打开分享下载页</span>
        </div>
        <div class="share-code-card">
          <span class="share-code-label">分享码</span>
          <strong>{{ result.shareCode }}</strong>
          <button type="button" @click="copyShareCode">
            <Copy size="14" fill="currentColor" />
            {{ copiedCode ? "已复制" : "复制分享码" }}
          </button>
          <button type="button" @click="copyShareMessage">
            <Copy size="14" fill="currentColor" />
            {{ copiedMessage ? "已复制" : "复制完整文案" }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Copy, LinkOne, ShareOne } from "@icon-park/vue-next";
import QRCode from "qrcode";
import type { ShareUploadResult } from "../utils/replay-share";

const props = defineProps<{
  retentionDays: 7 | 90;
  inviteCode: string;
  canShare: boolean;
  busy: boolean;
  fileName: string;
  result: ShareUploadResult | null;
  error: string;
}>();

const emit = defineEmits<{
  "update:retention-days": [value: 7 | 90];
  "update:invite-code": [value: string];
  share: [];
}>();

const copied = ref(false);
const copiedCode = ref(false);
const copiedMessage = ref(false);
const qrDataUrl = ref("");
let qrGeneration = 0;

function onInviteInput(event: Event) {
  emit("update:invite-code", (event.target as HTMLInputElement).value);
}

async function copyLink() {
  if (!props.result) return;
  await navigator.clipboard.writeText(props.result.shareUrl);
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1800);
}

async function copyShareCode() {
  if (!props.result) return;
  await navigator.clipboard.writeText(props.result.shareCode);
  copiedCode.value = true;
  window.setTimeout(() => (copiedCode.value = false), 1800);
}

async function copyShareMessage() {
  if (!props.result) return;
  const codePageUrl = `${window.location.origin}/code`;
  const message = `我分享了一局吉星派对回放【${props.fileName}】，分享码：${props.result.shareCode}。前往${codePageUrl}填写分享码即可下载观看！`;
  await navigator.clipboard.writeText(message);
  copiedMessage.value = true;
  window.setTimeout(() => (copiedMessage.value = false), 1800);
}

watch(
  () => props.result?.shareUrl,
  async (shareUrl) => {
    const generation = ++qrGeneration;
    qrDataUrl.value = "";
    if (!shareUrl) return;
    try {
      const dataUrl = await QRCode.toDataURL(shareUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 180,
        color: {
          dark: "#21112c",
          light: "#fff9ff",
        },
      });
      if (generation === qrGeneration) qrDataUrl.value = dataUrl;
    } catch {
      // 链接文字仍可复制，二维码失败不应影响分享结果。
    }
  },
  { immediate: true },
);

function formatExpiry(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
</script>

<style scoped>
.share-panel {
  padding: 22px;
}
.share-block {
  margin-top: 21px;
}
.share-label {
  margin-bottom: 10px;
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}
.retention-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.retention-row button {
  display: grid;
  gap: 3px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--ink);
  background: rgba(9, 5, 21, 0.28);
  font-size: 13px;
}
.retention-row button.selected {
  border-color: rgba(244, 198, 108, 0.5);
  background: rgba(244, 198, 108, 0.08);
}
.retention-row small {
  color: var(--muted);
  font-size: 12px;
}
.invite-input,
.link-row input {
  width: 100%;
  min-width: 0;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--ink);
  background: rgba(9, 5, 21, 0.44);
  outline: none;
}
.invite-input {
  margin-top: 9px;
  font-size: 13px;
}
.invite-input:focus,
.link-row input:focus {
  border-color: var(--purple);
  box-shadow: 0 0 0 3px rgba(169, 108, 255, 0.12);
}
.share-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  margin-top: 20px;
  padding: 13px 15px;
  border: 0;
  border-radius: 11px;
  color: #10251f;
  background: linear-gradient(110deg, #82e4c1, #b5efda);
  font-size: 13px;
  font-weight: 800;
}
.share-button:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.06);
}
.share-error {
  margin-top: 11px;
  font-size: 12px;
  line-height: 1.55;
}
.share-error {
  color: #ff9db0;
}
.share-result {
  margin-top: 16px;
  padding: 13px;
  border: 1px solid rgba(118, 226, 186, 0.25);
  border-radius: 12px;
  background: rgba(118, 226, 186, 0.06);
}
.result-heading,
.result-heading span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.result-heading {
  justify-content: space-between;
  color: var(--green);
  font-size: 13px;
  font-weight: 700;
}
.result-heading small {
  color: var(--muted);
  font-size: 11px;
  font-weight: 400;
}
.link-row {
  display: flex;
  gap: 7px;
  margin-top: 11px;
}
.link-row input {
  font-family: "Manrope", monospace;
  font-size: 11px;
}
.link-row button {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 0 11px;
  border: 1px solid rgba(118, 226, 186, 0.28);
  border-radius: 9px;
  color: var(--green);
  background: rgba(13, 37, 31, 0.72);
  font-size: 12px;
}
.share-result p {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.5;
}
.share-result-grid {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 13px;
  align-items: stretch;
  margin-top: 14px;
}
.share-result-grid:not(.has-qr) {
  grid-template-columns: 1fr;
}
.qr-card,
.share-code-card {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 8px;
  min-width: 0;
  padding: 11px;
  border: 1px solid rgba(193, 160, 255, 0.16);
  border-radius: 10px;
  background: rgba(9, 5, 21, 0.3);
}
.qr-card img {
  display: block;
  width: 150px;
  height: 150px;
  border-radius: 5px;
}
.qr-card span,
.share-code-label {
  color: var(--muted);
  font-size: 11px;
}
.share-code-card {
  justify-items: stretch;
  text-align: center;
}
.share-code-card strong {
  overflow: hidden;
  color: var(--gold);
  font-family: "Manrope", monospace;
  font-size: clamp(22px, 4vw, 28px);
  letter-spacing: 0.12em;
  text-overflow: ellipsis;
}
.share-code-card button,
.share-code-card a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 31px;
  padding: 7px 9px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 700;
}
.share-code-card button {
  border: 1px solid rgba(244, 198, 108, 0.28);
  color: var(--gold);
  background: rgba(244, 198, 108, 0.08);
}
.share-code-card a {
  border: 1px solid rgba(193, 160, 255, 0.18);
  color: var(--purple-bright);
  text-decoration: none;
}
.share-code-card button:hover,
.share-code-card a:hover {
  border-color: rgba(244, 198, 108, 0.5);
  background: rgba(244, 198, 108, 0.14);
}

@media (max-width: 620px) {
  .share-panel {
    padding: 18px;
  }
  .result-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .share-result-grid {
    grid-template-columns: 1fr;
  }
}
</style>
