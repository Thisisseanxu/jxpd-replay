<template>
  <SharedReplayView
    v-if="sharedCapability"
    :loading="sharedLoading"
    :status="sharedStatus"
    :error="sharedError"
    :analysis="sharedAnalysis"
    :privacy-mode="sharedPrivacyMode"
    :expires-at="sharedExpiresAt"
    :default-download-name="sharedDefaultDownloadName"
    @download="downloadSharedReplay"
    @back="leaveSharedReplay"
  />

  <main v-else class="app-shell share-page">
    <div class="ambient ambient-one" />
    <div class="ambient ambient-two" />

    <section class="workspace-heading">
      <div class="heading-lockup">
        <div class="brand-mark" aria-hidden="true">
          <img :src="logoUrl" alt="" />
        </div>
        <div class="heading-copy">
          <h1>分享回放</h1>
          <p>上传回放文件，生成一个安全的临时分享链接。</p>
        </div>
      </div>
      <RouterLink class="page-nav" to="/"
        >打开匿名化工具 <Right size="15" fill="currentColor"
      /></RouterLink>
    </section>

    <section class="content-grid">
      <div class="main-column">
        <ReplayUploader
          :file="file"
          :analysis="analysis"
          :busy="busy"
          :notice="notice"
          :dragging="dragging"
          kicker="导入待分享回放"
          empty-hint="建议先使用匿名化工具处理回放"
          @file-selected="handleFileSelected"
          @clear="clearFile"
          @dragging-change="dragging = $event"
        />

        <section
          v-if="privacyAssessment"
          class="panel privacy-status"
          :class="`is-${privacyAssessment}`"
        >
          <div class="privacy-status-icon"><Shield size="19" fill="currentColor" /></div>
          <div>
            <strong>{{ privacyTitle }}</strong>
            <p>{{ privacyDescription }}</p>
          </div>
        </section>
      </div>

      <aside class="side-column">
        <ReplaySharePanel
          :retention-days="retentionDays"
          :invite-code="inviteCode"
          :can-share="Boolean(analysis && sourceBytes)"
          :busy="shareBusy"
          :busy-label="shareBusyLabel"
          :compressed-bytes="compressedBytes"
          :result="shareResult"
          :error="shareError"
          @update:retention-days="retentionDays = $event"
          @update:invite-code="inviteCode = $event"
          @share="shareReplay"
        />

        <section v-if="privacyAssessment === 'original'" class="panel risk-panel">
          <div class="risk-heading"><Shield size="17" fill="currentColor" /> 文件尚未匿名化</div>
          <p>你仍可以继续分享原始文件，但其中可能包含玩家昵称、账号或房间信息。</p>
          <button type="button" @click="goToAnonymizer">
            先去匿名化工具处理 <Right size="15" fill="currentColor" />
          </button>
        </section>
      </aside>
    </section>

    <footer class="page-footer">
      <span class="footer-meta">
        <span>吉星派对 Replay Lab</span>
        <span>v{{ appVersion }}</span>
      </span>
      <a
        href="https://github.com/Thisisseanxu/jxpd-replay"
        target="_blank"
        rel="noopener noreferrer"
        ><GithubOne theme="outline" size="14" />开源地址</a
      >
    </footer>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { GithubOne, Right, Shield } from "@icon-park/vue-next";
import ReplaySharePanel from "./components/ReplaySharePanel.vue";
import ReplayUploader from "./components/ReplayUploader.vue";
import SharedReplayView from "./components/SharedReplayView.vue";
import { detectReplayPrivacy, inspectReplay } from "./utils/replay";
import type {
  ReplayAnalysis,
  ReplayPrivacyAssessment,
} from "./utils/replay";
import {
  capabilityFromHash,
  decodeSharedReplay,
  encodeReplayForShare,
  fetchSharedReplay,
  uploadReplay,
} from "./utils/replay-share";
import type { ShareUploadResult } from "./utils/replay-share";
import type { ReplayPrivacyMode } from "./utils/replay-container";
import {
  createReplayDownload,
  defaultSharedReplayName,
} from "./utils/replay-download";
import type { ReplayDownloadOptions } from "./utils/replay-download";
import {
  putReplayHandoff,
  takeReplayHandoff,
} from "./utils/replay-handoff";
import { ROOT_PATH, SHARE_PATH } from "./utils/routes";

const router = useRouter();
const route = useRoute();
const appVersion = __APP_VERSION__;
const logoUrl = `${import.meta.env.BASE_URL}logo.webp`;

const file = ref<File | null>(null);
const sourceBytes = ref<Uint8Array | null>(null);
const analysis = ref<ReplayAnalysis | null>(null);
const notice = ref("等待导入回放文件");
const dragging = ref(false);
const busy = ref(false);
const privacyAssessment = ref<ReplayPrivacyAssessment | null>(null);
const handoffPrivacyMode = ref<ReplayPrivacyMode | null>(null);

const retentionDays = ref<7 | 90>(7);
const inviteCode = ref("");
const shareBusy = ref(false);
const shareBusyLabel = ref("极限压缩中…");
const compressedBytes = ref<number | null>(null);
const shareResult = ref<ShareUploadResult | null>(null);
const shareError = ref("");

const sharedCapability = ref<string | null>(
  import.meta.env.SSR ? null : capabilityFromHash(),
);
const sharedLoading = ref(false);
const sharedStatus = ref("正在连接安全存储…");
const sharedError = ref("");
const sharedAnalysis = ref<ReplayAnalysis | null>(null);
const sharedBytes = ref<Uint8Array | null>(null);
const sharedPrivacyMode = ref<ReplayPrivacyMode | null>(null);
const sharedExpiresAt = ref("");
let sharedLoadGeneration = 0;
const sharedDefaultDownloadName = computed(() =>
  defaultSharedReplayName(sharedCapability.value || "replay"),
);

const effectivePrivacyMode = computed<ReplayPrivacyMode>(
  () => handoffPrivacyMode.value || privacyAssessment.value || "original",
);
const privacyTitle = computed(() => {
  if (privacyAssessment.value === "anonymous") return "已识别为匿名回放";
  if (privacyAssessment.value === "custom") return "已识别为自定义匿名回放";
  return "这个文件可能仍包含身份信息";
});
const privacyDescription = computed(() => {
  if (privacyAssessment.value === "anonymous") {
    return "玩家信息已替换为匿名标签，可以直接创建分享链接。";
  }
  if (privacyAssessment.value === "custom") {
    return "文件已经过匿名化处理，部分内容可能按原设置保留。";
  }
  return "分享前建议先使用匿名化工具处理，避免泄露玩家信息。";
});

watch([retentionDays, inviteCode], resetShareResult);

async function handleFileSelected(
  nextFile: File,
  privacyModeOverride: ReplayPrivacyMode | null = null,
) {
  busy.value = true;
  notice.value = "正在读取本地回放…";
  resetShareResult();
  try {
    const data = new Uint8Array(await nextFile.arrayBuffer());
    const nextAnalysis = inspectReplay(data);
    file.value = nextFile;
    sourceBytes.value = data;
    analysis.value = nextAnalysis;
    handoffPrivacyMode.value = privacyModeOverride;
    privacyAssessment.value = privacyModeOverride || detectPrivacy(nextAnalysis);
    notice.value = `已解析 ${nextAnalysis.frameCount.toLocaleString()} 个回放帧`;
  } catch (error) {
    file.value = null;
    sourceBytes.value = null;
    analysis.value = null;
    privacyAssessment.value = null;
    handoffPrivacyMode.value = null;
    notice.value = error instanceof Error ? error.message : "无法解析这个回放文件";
  } finally {
    busy.value = false;
    dragging.value = false;
  }
}

function detectPrivacy(nextAnalysis: ReplayAnalysis) {
  return detectReplayPrivacy(nextAnalysis);
}

function clearFile() {
  file.value = null;
  sourceBytes.value = null;
  analysis.value = null;
  privacyAssessment.value = null;
  handoffPrivacyMode.value = null;
  resetShareResult();
  notice.value = "等待导入回放文件";
}

function resetShareResult() {
  compressedBytes.value = null;
  shareResult.value = null;
  shareError.value = "";
}

async function shareReplay() {
  if (!sourceBytes.value || !analysis.value || shareBusy.value) return;
  shareBusy.value = true;
  shareError.value = "";
  shareResult.value = null;
  compressedBytes.value = null;
  shareBusyLabel.value = "极限压缩中…";
  try {
    const container = await encodeReplayForShare(
      sourceBytes.value,
      effectivePrivacyMode.value,
    );
    compressedBytes.value = container.length;
    shareBusyLabel.value = "安全上传中…";
    shareResult.value = await uploadReplay(
      container,
      retentionDays.value,
      inviteCode.value,
    );
    notice.value = "分享链接已生成";
  } catch (error) {
    shareError.value = error instanceof Error ? error.message : "无法生成分享链接";
  } finally {
    shareBusy.value = false;
  }
}

async function goToAnonymizer() {
  if (!sourceBytes.value || !file.value || busy.value || shareBusy.value) return;
  try {
    await putReplayHandoff(
      "anonymizer",
      sourceBytes.value,
      file.value.name,
      "original",
    );
    await router.push(ROOT_PATH);
  } catch (error) {
    shareError.value =
      error instanceof Error ? error.message : "无法把文件交给匿名化工具";
  }
}

async function consumeHandoff() {
  try {
    const handoff = await takeReplayHandoff("share");
    if (!handoff) return;
    const transferredFile = new File(
      [handoff.bytes.slice().buffer as ArrayBuffer],
      handoff.fileName,
      { type: "application/octet-stream" },
    );
    await handleFileSelected(transferredFile, handoff.privacyMode);
  } catch (error) {
    shareError.value =
      error instanceof Error ? error.message : "无法读取匿名化工具传来的文件";
  }
}

async function loadSharedReplay(capability: string) {
  const generation = ++sharedLoadGeneration;
  sharedLoading.value = true;
  sharedError.value = "";
  sharedAnalysis.value = null;
  sharedBytes.value = null;
  sharedStatus.value = "正在连接安全存储…";
  try {
    const downloaded = await fetchSharedReplay(capability);
    if (generation !== sharedLoadGeneration) return;
    sharedExpiresAt.value = downloaded.expiresAt;
    sharedStatus.value = "正在本机解压并校验…";
    const decoded = await decodeSharedReplay(downloaded.bytes);
    if (generation !== sharedLoadGeneration) return;
    sharedPrivacyMode.value = decoded.privacyMode;
    sharedBytes.value = decoded.bytes;
    sharedAnalysis.value = inspectReplay(decoded.bytes);
  } catch (error) {
    if (generation !== sharedLoadGeneration) return;
    sharedError.value =
      error instanceof Error ? error.message : "无法读取这个分享回放";
  } finally {
    if (generation === sharedLoadGeneration) sharedLoading.value = false;
  }
}

function downloadSharedReplay(options: ReplayDownloadOptions) {
  if (!sharedBytes.value || !sharedCapability.value) return;
  const payload = createReplayDownload(
    sharedBytes.value,
    options,
    sharedDefaultDownloadName.value,
  );
  const url = URL.createObjectURL(
    new Blob([payload.bytes.buffer as ArrayBuffer], {
      type: payload.mimeType,
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = payload.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function leaveSharedReplay() {
  sharedLoadGeneration += 1;
  void router.replace({ path: SHARE_PATH, query: route.query });
  sharedCapability.value = null;
  sharedAnalysis.value = null;
  sharedBytes.value = null;
  sharedError.value = "";
}

function onHashChange() {
  const nextCapability = capabilityFromHash();
  sharedCapability.value = nextCapability;
  if (nextCapability) void loadSharedReplay(nextCapability);
}

onMounted(() => {
  window.addEventListener("hashchange", onHashChange);
  if (sharedCapability.value) void loadSharedReplay(sharedCapability.value);
  else void consumeHandoff();
});

onBeforeUnmount(() => {
  window.removeEventListener("hashchange", onHashChange);
});
</script>

<style scoped>
.share-page .workspace-heading {
  gap: 24px;
}
.page-nav {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: none;
  padding: 10px 13px;
  border: 1px solid rgba(193, 160, 255, 0.2);
  border-radius: 10px;
  color: var(--purple-bright);
  background: rgba(169, 108, 255, 0.08);
  font-size: 12px;
  text-decoration: none;
  transition: 0.18s ease;
}
.page-nav:hover {
  border-color: rgba(211, 177, 255, 0.42);
  color: var(--ink);
  background: rgba(169, 108, 255, 0.15);
}
.privacy-status,
.risk-panel {
  display: flex;
  gap: 12px;
  padding: 16px 18px;
}
.privacy-status-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: var(--green);
  background: rgba(118, 226, 186, 0.1);
}
.privacy-status.is-original .privacy-status-icon {
  color: var(--gold);
  background: rgba(244, 198, 108, 0.1);
}
.privacy-status strong {
  display: block;
  color: var(--ink);
  font-size: 13px;
}
.privacy-status p,
.risk-panel p {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}
.risk-panel {
  display: block;
  border-color: rgba(244, 198, 108, 0.24);
  background: linear-gradient(
    145deg,
    rgba(74, 48, 31, 0.3),
    rgba(23, 15, 45, 0.84)
  );
}
.risk-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--gold);
  font-size: 13px;
  font-weight: 800;
}
.risk-panel button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 13px;
  padding: 8px 10px;
  border: 1px solid rgba(244, 198, 108, 0.28);
  border-radius: 9px;
  color: var(--gold);
  background: rgba(244, 198, 108, 0.08);
  font-size: 12px;
  font-weight: 700;
}
.risk-panel button:hover {
  border-color: rgba(244, 198, 108, 0.52);
  background: rgba(244, 198, 108, 0.14);
}

@media (max-width: 620px) {
  .share-page .workspace-heading {
    gap: 14px;
  }
  .page-nav {
    width: 100%;
    justify-content: center;
  }
}
</style>
