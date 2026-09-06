<template>
  <main class="app-shell">
    <div class="ambient ambient-one" />
    <div class="ambient ambient-two" />

    <section class="workspace-heading">
      <div>
        <div class="eyebrow">
          <div class="brand-mark" aria-hidden="true">
            <Star size="17" fill="currentColor" />
          </div>
          吉星派对
        </div>
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
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { GithubOne, Star } from "@icon-park/vue-next";
import { zipSync } from "fflate";
import AnonymizeSettings from "./components/AnonymizeSettings.vue";
import ReplayOverview from "./components/ReplayOverview.vue";
import ReplayUploader from "./components/ReplayUploader.vue";
import { anonymizeReplay, inspectReplay } from "./utils/replay";
import type { ReplayAnalysis } from "./utils/replay";

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

const players = computed(() => analysis.value?.players ?? []);

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
  display: grid;
  place-items: center;
  width: 35px;
  height: 35px;
  color: #fff0be;
  border: 1px solid rgba(244, 198, 108, 0.5);
  border-radius: 12px;
  background: linear-gradient(145deg, #6c3fa1, #35205f);
  box-shadow:
    0 0 22px rgba(167, 96, 255, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
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
  align-items: flex-end;
  justify-content: space-between;
  margin: 0 auto;
  padding: 16px 0 16px;
}
.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--gold);
  font-size: 18px;
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
}
</style>
