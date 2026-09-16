<template>
  <main class="app-shell">
    <div class="ambient ambient-one" />
    <div class="ambient ambient-two" />

    <section class="workspace-heading">
      <div class="heading-lockup">
        <div class="brand-mark" aria-hidden="true">
          <img :src="logoUrl" alt="" />
        </div>
        <div class="heading-copy">
          <h1>回放匿名化工具</h1>
          <p>在分享对局前匿名队友的信息吧~</p>
        </div>
      </div>
      <div class="eyebrow">吉星派对</div>
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
          @share="prepareShare"
        />
      </aside>
    </section>

    <footer class="page-footer">
      <span class="footer-meta">
        <span>吉星派对 Replay Lab</span>
        <span>v{{ appVersion }}</span>
      </span>
      <div class="footer-links">
        <a
          href="https://www.bilibili.com/video/BV1mvbV6oEf9/"
          target="_blank"
          rel="noopener noreferrer"
          ><Help size="21" fill="currentColor" />如何使用回放</a
        >
        <a
          href="https://www.bilibili.com/video/BV13FY26vEXf/"
          target="_blank"
          rel="noopener noreferrer"
          ><Help size="21" fill="currentColor" />使用教程</a
        >
        <a
          href="https://github.com/Thisisseanxu/jxpd-replay"
          target="_blank"
          rel="noopener noreferrer"
          ><GithubOne theme="outline" size="21" />开源地址</a
        >
      </div>
    </footer>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { GithubOne, Help } from "@icon-park/vue-next";
import { zipSync } from "fflate";
import AnonymizeSettings from "../components/AnonymizeSettings.vue";
import ReplayOverview from "../components/ReplayOverview.vue";
import ReplayUploader from "../components/ReplayUploader.vue";
import { anonymizeReplay, inspectReplay } from "../utils/replay";
import type { ReplayAnalysis } from "../utils/replay";
import { capabilityFromHash } from "../utils/replay-share";
import { putReplayHandoff, takeReplayHandoff } from "../utils/replay-handoff";
import { sharePagePath } from "../utils/routes";

const router = useRouter();
const file = ref<File | null>(null);
const sourceBytes = ref<Uint8Array | null>(null);
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

const players = computed(() => analysis.value?.players ?? []);

async function handleFileSelected(nextFile: File) {
  busy.value = true;
  notice.value = "正在读取本地回放…";
  lastExport.value = null;
  try {
    const data = new Uint8Array(await nextFile.arrayBuffer());
    const nextAnalysis = inspectReplay(data);
    file.value = nextFile;
    sourceBytes.value = data;
    analysis.value = nextAnalysis;
    exportName.value = nextFile.name;
    notice.value = "回放文件已加载";
  } catch (error) {
    file.value = null;
    sourceBytes.value = null;
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
  sourceBytes.value = null;
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
    const result = createAnonymousReplay();
    if (!result) return;
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

function createAnonymousReplay() {
  if (!analysis.value) return null;
  return anonymizeReplay(
    analysis.value,
    new Set(revealPlayers.value),
    preserveRoomName.value,
  );
}

async function prepareShare() {
  if (busy.value) return;
  if (!analysis.value || !file.value || !sourceBytes.value) {
    await router.push(sharePagePath());
    return;
  }
  busy.value = true;
  notice.value = "正在准备匿名化副本…";
  try {
    const result = createAnonymousReplay();
    if (!result) return;
    await putReplayHandoff(
      "share",
      result.bytes,
      normalizeExportName(exportName.value, file.value.name),
      revealPlayers.value.length === 0 && !preserveRoomName.value
        ? "anonymous"
        : "custom",
    );
    await router.push(sharePagePath());
  } catch (error) {
    notice.value =
      error instanceof Error ? error.message : "无法准备分享文件";
  } finally {
    busy.value = false;
  }
}

async function consumeAnonymizerHandoff() {
  try {
    const handoff = await takeReplayHandoff("anonymizer");
    if (!handoff) return;
    const nextFile = new File(
      [handoff.bytes.slice().buffer as ArrayBuffer],
      handoff.fileName,
      { type: "application/octet-stream" },
    );
    await handleFileSelected(nextFile);
  } catch (error) {
    notice.value =
      error instanceof Error ? error.message : "无法读取分享页传来的文件";
  }
}

onMounted(() => {
  if (capabilityFromHash()) {
    void router.replace(sharePagePath(location.search, location.hash));
    return;
  }
  void consumeAnonymizerHandoff();
});
</script>
