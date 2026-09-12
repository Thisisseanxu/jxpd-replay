<template>
  <main class="app-shell">
    <div class="ambient ambient-one" />
    <div class="ambient ambient-two" />

    <section class="workspace-heading">
      <div class="eyebrow">
        <div class="brand-mark" aria-hidden="true">
          <img :src="logoUrl" alt="" />
        </div>
        吉星派对
      </div>
      <div class="heading-copy">
        <h1>回放匿名化</h1>
        <p>在分享对局前匿名队友的信息吧~</p>
      </div>
    </section>

    <section class="content-grid">
      <div class="main-column">
        <ReplayUploader
          :file="file"
          :analysis="analysis"
          :busy="busy"
          :notice="notice"
          :dragging="dragging"
          @file-selected="handleFileSelected"
          @clear="clearFile"
          @dragging-change="dragging = $event"
        />
        <ReplayOverview :analysis="analysis" :reveal-players="revealPlayers" />
      </div>

      <aside class="side-column">
        <AnonymizeSettings
          :players="players"
          :reveal-players="revealPlayers"
          :preserve-room-name="preserveRoomName"
          :export-name="exportName"
          :zip-export="zipExport"
          :busy="busy"
          :can-export="Boolean(analysis)"
          :last-export="lastExport"
          @toggle-player="toggleRevealPlayer"
          @all-anonymous="setAllAnonymous"
          @update:preserve-room-name="preserveRoomName = $event"
          @update:export-name="exportName = $event"
          @update:zip-export="zipExport = $event"
          @export="exportReplay"
        />
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

  <Transition name="update-slide">
    <aside
      v-if="showUpdateDialog"
      class="update-notification"
      :class="`is-${updatePhase}`"
      role="status"
      aria-live="polite"
    >
      <div class="update-icon" aria-hidden="true">
        <UpdateRotation
          theme="outline"
          size="20"
          fill="currentColor"
          :class="{ 'icon-spin': updatePhase !== 'ready' }"
        />
      </div>
      <div class="notification-content">
        <strong>{{ updateHeadline }}</strong>
        <span>{{ updateDetail }}</span>
      </div>
      <div class="update-actions">
        <button
          v-if="updatePhase === 'ready'"
          class="update-button"
          type="button"
          @click="confirmUpdate"
        >
          立即更新
        </button>
        <button
          v-if="updatePhase === 'ready'"
          class="update-dismiss"
          type="button"
          @click="dismissUpdate"
        >
          稍后
        </button>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { GithubOne, UpdateRotation } from "@icon-park/vue-next";
import { zipSync } from "fflate";
import AnonymizeSettings from "./components/AnonymizeSettings.vue";
import ReplayOverview from "./components/ReplayOverview.vue";
import ReplayUploader from "./components/ReplayUploader.vue";
import { anonymizeReplay, inspectReplay } from "./utils/replay";
import type { ReplayAnalysis } from "./utils/replay";
import { useRegisterSW } from "virtual:pwa-register/vue";

const file = ref<File | null>(null);
const analysis = ref<ReplayAnalysis | null>(null);
const revealPlayers = ref<number[]>([]);
const preserveRoomName = ref(false);
const exportName = ref("");
const zipExport = ref(false);
const dragging = ref(false);
const busy = ref(false);
const notice = ref("等待导入回放文件");
const lastExport = ref<string | null>(null);
const appVersion = __APP_VERSION__;
const logoUrl = `${import.meta.env.BASE_URL}logo.webp`;
const showUpdateDialog = ref(false);
const isUpdating = ref(false);
const isUpdateDownloading = ref(false);
const updatePhase = ref<"downloading" | "ready" | "applying">("downloading");
const updateStatusMessage = ref("新版本正在后台下载，期间仍可继续使用。");
let updateFallbackTimer: number | null = null;
let removeUpdateFoundListener: (() => void) | null = null;
let updateServiceWorker: (reloadPage?: boolean) => Promise<void> | void = () => {};

const needRefresh = ref(false);

if (!import.meta.env.SSR) {
  const registration = useRegisterSW({
    onRegisteredSW(_swScriptUrl, swRegistration) {
      watchForServiceWorkerUpdates(swRegistration);
    },
  });
  needRefresh.value = registration.needRefresh.value;
  watch(registration.needRefresh, (value) => {
    needRefresh.value = value;
  });
  updateServiceWorker = registration.updateServiceWorker;
}

const players = computed(() => analysis.value?.players ?? []);
const updateHeadline = computed(() => {
  if (updatePhase.value === "downloading") return "正在下载更新";
  if (updatePhase.value === "applying") return "正在应用更新";
  return "发现新版本";
});
const updateDetail = computed(() => {
  if (updatePhase.value === "downloading") return updateStatusMessage.value;
  if (updatePhase.value === "applying") return updateStatusMessage.value;
  return "新版本已经准备好，更新后页面会自动刷新。";
});

watch(needRefresh, (value) => {
  if (value) {
    isUpdateDownloading.value = false;
    isUpdating.value = false;
    updatePhase.value = "ready";
    updateStatusMessage.value = "新版本已经下载完成。";
    showUpdateDialog.value = true;
    return;
  }

  showUpdateDialog.value = false;
  isUpdating.value = false;
  clearUpdateFallbackTimer();
  updatePhase.value = "downloading";
  updateStatusMessage.value = "新版本正在后台下载，期间仍可继续使用。";
});

watch(isUpdateDownloading, (value) => {
  if (value && !needRefresh.value && !isUpdating.value) {
    updatePhase.value = "downloading";
    updateStatusMessage.value = "新版本正在后台下载，期间仍可继续使用。";
    showUpdateDialog.value = true;
  }
});

function watchForServiceWorkerUpdates(registration: ServiceWorkerRegistration | undefined) {
  if (!registration) return;

  const trackInstallingWorker = () => {
    const worker = registration.installing;
    // 首次安装没有现有 controller，不应把首次缓存显示成更新下载。
    if (!worker || !navigator.serviceWorker.controller) return;

    isUpdateDownloading.value = true;
    const handleStateChange = () => {
      if (worker.state !== "installing") {
        isUpdateDownloading.value = false;
        worker.removeEventListener("statechange", handleStateChange);
      }
    };
    worker.addEventListener("statechange", handleStateChange);
    handleStateChange();
  };

  registration.addEventListener("updatefound", trackInstallingWorker);
  removeUpdateFoundListener = () => {
    registration.removeEventListener("updatefound", trackInstallingWorker);
  };
  trackInstallingWorker();
}

function clearUpdateFallbackTimer() {
  if (updateFallbackTimer !== null) {
    window.clearTimeout(updateFallbackTimer);
    updateFallbackTimer = null;
  }
}

function dismissUpdate() {
  if (isUpdating.value || isUpdateDownloading.value) return;
  showUpdateDialog.value = false;
}

function confirmUpdate() {
  if (isUpdating.value) return;

  if (!("serviceWorker" in navigator)) {
    window.location.reload();
    return;
  }

  isUpdating.value = true;
  updatePhase.value = "applying";
  updateStatusMessage.value = "正在切换到新版本，请稍候…";
  clearUpdateFallbackTimer();

  const handleControllerChange = () => {
    clearUpdateFallbackTimer();
    updateStatusMessage.value = "更新完成，正在刷新页面…";
    window.setTimeout(() => window.location.reload(), 200);
  };
  navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange, {
    once: true,
  });

  Promise.resolve(updateServiceWorker(true)).catch(() => {
    isUpdating.value = false;
    updatePhase.value = "ready";
    updateStatusMessage.value = "更新失败，请稍后重试。";
    clearUpdateFallbackTimer();
  });

  updateFallbackTimer = window.setTimeout(() => {
    updateStatusMessage.value = "更新响应较慢，正在尝试刷新页面…";
    window.location.reload();
  }, 30000);
}

onBeforeUnmount(() => {
  clearUpdateFallbackTimer();
  removeUpdateFoundListener?.();
});

async function handleFileSelected(nextFile: File) {
  busy.value = true;
  notice.value = "正在读取本地回放…";
  lastExport.value = null;
  try {
    const data = new Uint8Array(await nextFile.arrayBuffer());
    const nextAnalysis = inspectReplay(data);
    file.value = nextFile;
    analysis.value = nextAnalysis;
    exportName.value = nextFile.name;
    notice.value = `已解析 ${nextAnalysis.frameCount.toLocaleString()} 个回放帧`;
  } catch (error) {
    file.value = null;
    analysis.value = null;
    exportName.value = "";
    notice.value =
      error instanceof Error ? error.message : "无法解析这个回放文件";
  } finally {
    busy.value = false;
    dragging.value = false;
  }
}

function clearFile() {
  file.value = null;
  analysis.value = null;
  exportName.value = "";
  lastExport.value = null;
  notice.value = "等待导入回放文件";
}

function toggleRevealPlayer(number: number) {
  revealPlayers.value = revealPlayers.value.includes(number)
    ? revealPlayers.value.filter((item) => item !== number)
    : [...revealPlayers.value, number].sort((a, b) => a - b);
}

function setAllAnonymous() {
  revealPlayers.value = [];
}

function normalizeExportName(value: string, fallback: string) {
  const candidate = value.trim() || fallback.trim() || "replay";
  const safeName = candidate
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
    .join("")
    .replace(/[. ]+$/g, "");
  return safeName || "replay";
}

function exportReplay() {
  if (!analysis.value || !file.value || busy.value) return;
  busy.value = true;
  notice.value = "正在生成匿名化副本…";
  try {
    const result = anonymizeReplay(
      analysis.value,
      new Set(revealPlayers.value),
      preserveRoomName.value,
    );
    const outputName = normalizeExportName(exportName.value, file.value.name);
    const outputBytes = zipExport.value
      ? zipSync({ [`${outputName}/${outputName}`]: result.bytes })
      : result.bytes;
    const downloadName = zipExport.value ? `${outputName}.zip` : outputName;
    const url = URL.createObjectURL(
      new Blob([outputBytes], {
        type: zipExport.value ? "application/zip" : "application/octet-stream",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadName;
    link.click();
    URL.revokeObjectURL(url);
    lastExport.value = downloadName;
    notice.value = `已导出 ${result.changedFields.toLocaleString()} 个匿名化字段`;
  } catch (error) {
    notice.value = error instanceof Error ? error.message : "匿名化失败";
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.app-shell {
  position: relative;
  isolation: isolate;
  min-height: 100vh;
  overflow: hidden;
  padding: 0 clamp(20px, 5vw, 76px) 28px;
  background:
    radial-gradient(
      ellipse at 48% -12%,
      rgba(129, 58, 219, 0.27),
      transparent 46%
    ),
    linear-gradient(135deg, #0d0819 0%, #120b23 48%, #0e091b 100%);
}
.app-shell::before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 0;
  opacity: 0.27;
  pointer-events: none;
  background-image: radial-gradient(
    rgba(231, 202, 255, 0.54) 0.65px,
    transparent 0.8px
  );
  background-size: 42px 42px;
  mask-image: linear-gradient(to bottom, black, transparent 78%);
}
.ambient {
  position: absolute;
  z-index: -1;
  border-radius: 999px;
  filter: blur(2px);
  pointer-events: none;
}
.ambient-one {
  width: 230px;
  height: 230px;
  top: 280px;
  left: -140px;
  background: rgba(122, 55, 225, 0.12);
  box-shadow: 0 0 100px 50px rgba(122, 55, 225, 0.08);
}
.ambient-two {
  width: 200px;
  height: 200px;
  right: -100px;
  bottom: 80px;
  background: rgba(221, 94, 171, 0.08);
  box-shadow: 0 0 100px 50px rgba(221, 94, 171, 0.07);
}

.topbar {
  height: 82px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 1220px;
  margin: 0 auto;
  border-bottom: 1px solid rgba(193, 160, 255, 0.12);
}
.brand-lockup {
  display: flex;
  align-items: center;
  gap: 11px;
}
.brand-mark {
  width: 46px;
  height: 46px;
  flex: 0 0 46px;
}
.brand-mark img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.brand-name {
  font-weight: 800;
  font-size: 14px;
  letter-spacing: 0.08em;
}
.brand-product {
  margin-top: 2px;
  color: var(--soft);
  font-family: "Manrope", sans-serif;
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.brand-product span {
  color: var(--gold);
  padding: 0 3px;
}
.privacy-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border: 1px solid rgba(118, 226, 186, 0.22);
  border-radius: 999px;
  color: var(--green);
  background: rgba(118, 226, 186, 0.07);
  font-size: 12px;
  font-weight: 600;
}

.workspace-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 auto;
  padding: 16px 0 16px;
}
.heading-copy {
  min-width: 0;
  margin-left: auto;
  text-align: right;
}
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--gold);
  font-size: 21px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
h1 {
  margin: 11px 0 7px;
  font-size: clamp(31px, 4vw, 46px);
  line-height: 1.1;
  letter-spacing: -0.045em;
}
.workspace-heading p {
  margin: 0;
  color: var(--muted);
  font-size: 15px;
}
.heading-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px 14px;
  border: 1px solid rgba(169, 108, 255, 0.24);
  border-radius: 13px;
  color: var(--purple-bright);
  background: rgba(59, 29, 102, 0.22);
  font-size: 12px;
  line-height: 1.7;
}
.heading-note b {
  color: var(--ink);
  font-weight: 600;
}
.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.8fr);
  gap: 20px;
  max-width: 1220px;
  margin: 0 auto;
  align-items: start;
}
.main-column,
.side-column {
  display: grid;
  gap: 20px;
}
.page-footer {
  display: flex;
  justify-content: space-between;
  max-width: 1220px;
  margin: 22px auto 0;
  padding-top: 17px;
  border-top: 1px solid rgba(193, 160, 255, 0.1);
  color: #5f5474;
  font-family: "Manrope", "Noto Sans SC", sans-serif;
  font-size: 10px;
  letter-spacing: 0.04em;
}
.footer-meta {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}
.page-footer a {
  display: flex;
  align-items: center;
  gap: 0;
  color: var(--purple-bright);
  line-height: 1;
  text-decoration: none;
  transition: color 0.18s ease;
}
.page-footer a:hover {
  color: var(--ink);
  text-decoration: underline;
}

.update-notification {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 20;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  width: min(430px, calc(100vw - 40px));
  padding: 13px 14px 13px 13px;
  border: 1px solid rgba(211, 177, 255, 0.25);
  border-radius: 16px;
  color: var(--ink);
  background:
    linear-gradient(140deg, rgba(47, 28, 82, 0.97), rgba(24, 15, 48, 0.97)),
    var(--panel-strong);
  box-shadow:
    0 20px 55px rgba(0, 0, 0, 0.35),
    0 0 30px rgba(169, 108, 255, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(18px);
}
.update-notification.is-downloading {
  border-color: rgba(169, 108, 255, 0.38);
}
.update-notification.is-ready {
  border-color: rgba(118, 226, 186, 0.35);
}
.update-notification.is-applying {
  border-color: rgba(244, 198, 108, 0.38);
}
.update-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid rgba(211, 177, 255, 0.26);
  border-radius: 11px;
  color: var(--purple-bright);
  background: rgba(169, 108, 255, 0.12);
}
.is-ready .update-icon {
  color: var(--green);
  background: rgba(118, 226, 186, 0.1);
}
.is-applying .update-icon {
  color: var(--gold);
  background: rgba(244, 198, 108, 0.1);
}
.notification-content {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.notification-content strong {
  overflow: hidden;
  font-size: 13px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notification-content span {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.update-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}
.update-button,
.update-dismiss {
  border: 0;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}
.update-button {
  padding: 9px 11px;
  color: #24112f;
  background: linear-gradient(135deg, #e4b6ff, #a96cff);
  box-shadow: 0 7px 18px rgba(169, 108, 255, 0.23);
  transition: filter 0.18s ease, transform 0.18s ease;
}
.update-button:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}
.update-button:active {
  transform: translateY(0);
}
.update-dismiss {
  padding: 8px 3px;
  color: var(--soft);
  background: transparent;
  transition: color 0.18s ease;
}
.update-dismiss:hover {
  color: var(--ink);
}
.update-slide-enter-active,
.update-slide-leave-active {
  transition: opacity 0.24s ease, transform 0.24s ease;
}
.update-slide-enter-from,
.update-slide-leave-to {
  opacity: 0;
  transform: translateY(-12px) scale(0.98);
}
@keyframes update-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.icon-spin {
  animation: update-spin 1s linear infinite;
}

@media (max-width: 860px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
  .side-column {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 620px) {
  .app-shell {
    padding-inline: 15px;
  }
  .topbar {
    height: 70px;
  }
  .workspace-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 18px;
    padding-top: 39px;
  }
  .heading-copy {
    margin-left: 0;
    text-align: left;
  }
  .heading-note {
    width: 100%;
  }
  .side-column {
    grid-template-columns: 1fr;
  }
  .page-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 7px;
  }
  .footer-meta {
    gap: 9px;
  }
  .update-notification {
    top: 12px;
    right: 12px;
    left: 12px;
    width: auto;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 10px;
    padding: 11px 12px 11px 11px;
  }
  .update-icon {
    width: 34px;
    height: 34px;
  }
  .update-actions {
    grid-column: 2;
    justify-content: flex-start;
  }
}
</style>
