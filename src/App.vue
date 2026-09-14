<template>
  <router-view />

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
import { useRoute } from "vue-router";
import { useHead } from "@unhead/vue";
import { UpdateRotation } from "@icon-park/vue-next";
import { useRegisterSW } from "virtual:pwa-register/vue";
import { createPageHead } from "./utils/page-meta";

const route = useRoute();
const pageHead = computed(() => createPageHead(route));
useHead(pageHead);

const showUpdateDialog = ref(false);
const isUpdating = ref(false);
const isUpdateDownloading = ref(false);
const updatePhase = ref<"downloading" | "ready" | "applying">("downloading");
const updateStatusMessage = ref("新版本正在后台下载，期间仍可继续使用。");
let updateFallbackTimer: number | null = null;
let removeUpdateFoundListener: (() => void) | null = null;
let updateServiceWorker: (
  reloadPage?: boolean,
) => Promise<void> | void = () => {};

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

function watchForServiceWorkerUpdates(
  registration: ServiceWorkerRegistration | undefined,
) {
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
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    handleControllerChange,
    { once: true },
  );

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
</script>

<style scoped>
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
  transition:
    filter 0.18s ease,
    transform 0.18s ease;
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
  transition:
    opacity 0.24s ease,
    transform 0.24s ease;
}
.update-slide-enter-from,
.update-slide-leave-to {
  opacity: 0;
  transform: translateY(-12px) scale(0.98);
}
@keyframes update-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.icon-spin {
  animation: update-spin 1s linear infinite;
}

@media (max-width: 620px) {
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
