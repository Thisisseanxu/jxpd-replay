<template>
  <section class="panel upload-panel">
    <div class="panel-kicker"><span class="step-dot">01</span> 导入回放</div>
    <input ref="inputRef" type="file" class="sr-only" @change="onFileChange" />

    <div
      v-if="file && analysis"
      class="drop-zone has-file"
      :class="{ 'is-dragging': dragging }"
      @dragenter.prevent="setDragging(true)"
      @dragover.prevent
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <div class="file-loaded">
        <div class="file-icon"><FileText size="26" fill="currentColor" /></div>
        <div class="file-copy">
          <strong :title="file.name">{{ file.name }}</strong>
          <span
            >{{ formatBytes(analysis.size) }} <i />
            {{ analysis.frameCount.toLocaleString() }} 帧 <i />
            {{ analysis.commandCount }} 类命令</span
          >
        </div>
        <button
          class="quiet-button"
          type="button"
          aria-label="移除当前文件"
          @click.stop="$emit('clear')"
        >
          <Refresh size="15" fill="currentColor" /> 更换
        </button>
      </div>
    </div>

    <button
      v-else
      type="button"
      class="drop-zone"
      :class="{ 'is-dragging': dragging }"
      @dragenter.prevent="setDragging(true)"
      @dragover.prevent
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
      @click="inputRef?.click()"
    >
      <div class="upload-icon"><Upload size="24" fill="currentColor" /></div>
      <strong>拖入回放文件，或点击选择</strong>
      <span>请先导出回放文件</span>
      <div class="browse-hint">
        <FolderOpen size="14" fill="currentColor" /> 选择文件
      </div>
    </button>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { FileText, FolderOpen, Refresh, Upload } from "@icon-park/vue-next";
import { formatBytes } from "../utils/replay";
import type { ReplayAnalysis } from "../utils/replay";

defineProps<{
  file: File | null;
  analysis: ReplayAnalysis | null;
  busy: boolean;
  notice: string;
  dragging: boolean;
}>();

const emit = defineEmits<{
  "file-selected": [file: File];
  clear: [];
  "dragging-change": [dragging: boolean];
}>();

const inputRef = ref<HTMLInputElement | null>(null);

function setDragging(value: boolean) {
  emit("dragging-change", value);
}

function onDragLeave(event: DragEvent) {
  if (event.currentTarget === event.target) setDragging(false);
}

function acceptFile(file?: File) {
  if (file) emit("file-selected", file);
  setDragging(false);
}

function onDrop(event: DragEvent) {
  acceptFile(event.dataTransfer?.files?.[0]);
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  acceptFile(input.files?.[0]);
  input.value = "";
}
</script>

<style scoped>
.upload-panel {
  padding: 22px 22px 17px;
}
.drop-zone {
  min-height: 230px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 11px;
  width: 100%;
  margin-top: 16px;
  padding: 30px;
  border: 1px dashed rgba(192, 151, 255, 0.34);
  border-radius: 14px;
  color: var(--muted);
  background:
    radial-gradient(
      circle at 50% 15%,
      rgba(127, 65, 205, 0.17),
      transparent 58%
    ),
    rgba(13, 8, 28, 0.22);
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    transform 0.18s ease;
}
.drop-zone:hover,
.drop-zone.is-dragging {
  border-color: var(--purple);
  background:
    radial-gradient(
      circle at 50% 15%,
      rgba(155, 87, 241, 0.24),
      transparent 62%
    ),
    rgba(13, 8, 28, 0.34);
}
.drop-zone.is-dragging {
  transform: translateY(-2px);
}
.drop-zone strong {
  color: var(--ink);
  font-size: 16px;
  font-weight: 700;
}
.drop-zone > span {
  font-size: 12px;
}
.upload-icon,
.file-icon {
  display: grid;
  place-items: center;
  width: 55px;
  height: 55px;
  border: 1px solid rgba(169, 108, 255, 0.35);
  border-radius: 16px;
  color: var(--purple-bright);
  background: linear-gradient(
    145deg,
    rgba(140, 72, 221, 0.28),
    rgba(80, 45, 135, 0.18)
  );
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.browse-hint {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 4px;
  padding: 7px 10px;
  border: 1px solid rgba(193, 160, 255, 0.2);
  border-radius: 8px;
  color: var(--purple-bright);
  background: rgba(169, 108, 255, 0.09);
  font-size: 12px;
  font-weight: 600;
}
.drop-zone.has-file {
  min-height: 142px;
  align-items: stretch;
}
.file-loaded {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
}
.file-loaded .file-icon {
  flex: none;
  width: 51px;
  height: 51px;
}
.file-copy {
  min-width: 0;
  display: grid;
  gap: 7px;
  flex: 1;
}
.file-copy strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-copy span {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-family: "Manrope", sans-serif;
  font-size: 11px;
}
.file-copy i,
.status-line i {
  display: inline-block;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--soft);
}
.quiet-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 8px 10px;
  border: 1px solid rgba(193, 160, 255, 0.2);
  border-radius: 9px;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.02);
  font-size: 12px;
}
.quiet-button:hover {
  color: var(--ink);
  border-color: var(--line-bright);
}
.panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  margin-top: 15px;
  color: var(--soft);
  font-size: 11px;
}
.status-line {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.status-light {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 10px rgba(118, 226, 186, 0.8);
}
.status-light.is-busy {
  background: var(--gold);
  animation: pulse 1s ease-in-out infinite;
}
.format-hint {
  color: #635878;
  font-family: "Manrope", sans-serif;
}

@media (max-width: 620px) {
  .upload-panel {
    padding: 18px;
  }
  .drop-zone {
    min-height: 210px;
    padding: 22px 16px;
    text-align: center;
  }
  .drop-zone.has-file {
    min-height: 135px;
    text-align: left;
  }
  .file-loaded {
    flex-wrap: wrap;
  }
  .file-copy {
    max-width: calc(100% - 67px);
  }
  .quiet-button {
    margin-left: 65px;
  }
  .panel-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 7px;
  }
}
</style>
