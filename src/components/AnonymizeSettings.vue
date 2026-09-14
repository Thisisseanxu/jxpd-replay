<template>
  <section class="panel settings-panel">
    <div class="panel-kicker"><span class="step-dot">03</span> 匿名化设置</div>

    <div class="setting-block">
      <div class="setting-title">保留哪些玩家的真实昵称？</div>
      <div class="setting-subtitle">可多选；未勾选的玩家会替换为匿名标签。</div>
      <div class="player-picker">
        <button
          type="button"
          :class="{ selected: revealPlayers.length === 0 }"
          @click="$emit('all-anonymous')"
        >
          <span class="picker-avatar all">×</span><span>全部匿名</span>
        </button>
        <button
          v-for="number in 4"
          :key="number"
          type="button"
          :class="{ selected: revealPlayers.includes(number) }"
          :disabled="number > players.length"
          @click="$emit('toggle-player', number)"
        >
          <span class="picker-avatar" :class="`p${number}`">{{ number }}</span>
          <span class="picker-name" :title="displayName(number)">{{
            displayName(number)
          }}</span>
        </button>
      </div>
      <div class="selection-preview">
        <span class="selection-check"
          ><Check size="13" fill="currentColor"
        /></span>
        <template v-if="revealPlayers.length === 0"
          ><b>所有玩家</b> 将使用匿名标签</template
        >
        <template v-else-if="selectedPlayers.length"
          ><b>已保留 {{ selectedPlayers.length }} 位</b>：{{
            selectedPlayers
              .map((player) => player.originalName || player.label)
              .join("、")
          }}</template
        >
        <template v-else
          ><b>已选择 {{ revealPlayers.length }} 位</b
          >，导入后显示真实昵称</template
        >
      </div>
    </div>

    <div class="setting-divider" />
    <div class="setting-card">
      <label class="toggle-row" for="preserve-room-name" aria-label="保留房间名">
        <span class="toggle-copy"
          ><b>保留房间名</b><small>便于分享者辨认这场对局</small></span
        >
        <input
          id="preserve-room-name"
          type="checkbox"
          :checked="preserveRoomName"
          @change="onRoomNameChange"
        />
        <span class="toggle-ui" />
      </label>
    </div>
    <div class="setting-card">
      <div class="setting-block export-block">
        <div class="setting-title">导出文件名</div>
        <div class="setting-subtitle">默认与导入文件同名，可直接修改。</div>
        <input
          class="export-name-input"
          type="text"
          :value="exportName"
          :disabled="!canExport"
          placeholder="导入回放后自动填充"
          @input="onExportNameChange"
        />
      </div>
    </div>
    <div class="setting-card">
      <label class="toggle-row zip-export-toggle" for="zip-export">
        <span class="toggle-copy"
          ><b>导出 ZIP 压缩包</b><small>内部为同名文件夹和回放文件</small></span
        >
        <input
          id="zip-export"
          type="checkbox"
          :checked="zipExport"
          @change="onZipExportChange"
        />
        <span class="toggle-ui" />
      </label>
    </div>

    <div class="action-row">
      <button
        type="button"
        class="share-circle-button"
        :disabled="!canShare || busy"
        aria-label="使用匿名副本创建分享"
        title="使用匿名副本创建分享"
        @click="$emit('share')"
      >
        <ShareOne size="18" fill="currentColor" />
      </button>
      <button
        type="button"
        class="export-button"
        :disabled="!canExport || busy"
        @click="$emit('export')"
      >
        <ArrowDown size="18" fill="currentColor" />
        {{ busy ? "处理中…" : "导出匿名副本" }}
        <Right size="17" fill="currentColor" />
      </button>
    </div>
    <div v-if="lastExport" class="export-success">
      <Check size="15" fill="currentColor" /> 已生成 {{ lastExport }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  ArrowDown,
  Check,
  Lock,
  Right,
  ShareOne,
  Shield,
} from "@icon-park/vue-next";
import type { PlayerRecord } from "../utils/replay";

const props = defineProps<{
  players: PlayerRecord[];
  revealPlayers: number[];
  preserveRoomName: boolean;
  exportName: string;
  zipExport: boolean;
  busy: boolean;
  canExport: boolean;
  canShare: boolean;
  lastExport: string | null;
}>();

const emit = defineEmits<{
  "toggle-player": [number: number];
  "all-anonymous": [];
  "update:preserve-room-name": [value: boolean];
  "update:export-name": [value: string];
  "update:zip-export": [value: boolean];
  export: [];
  share: [];
}>();

const selectedPlayers = computed(() =>
  props.players.filter((_, index) => props.revealPlayers.includes(index + 1)),
);

function displayName(number: number) {
  return props.players[number - 1]?.originalName || `Player${number}`;
}

function onRoomNameChange(event: Event) {
  const input = event.target as HTMLInputElement;
  emit("update:preserve-room-name", input.checked);
}

function onExportNameChange(event: Event) {
  const input = event.target as HTMLInputElement;
  emit("update:export-name", input.value);
}

function onZipExportChange(event: Event) {
  const input = event.target as HTMLInputElement;
  emit("update:zip-export", input.checked);
}
</script>

<style scoped>
.settings-panel {
  padding: 22px;
}
.setting-block {
  margin-top: 23px;
}
.setting-title {
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
}
.setting-subtitle {
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}
.player-picker {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 15px;
}
.player-picker button {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(193, 160, 255, 0.15);
  border-radius: 10px;
  color: var(--muted);
  background: rgba(10, 6, 24, 0.26);
  font-size: 12px;
  text-align: left;
  transition: 0.18s ease;
}
.player-picker button:hover:not(:disabled) {
  border-color: rgba(193, 160, 255, 0.35);
  color: var(--ink);
}
.player-picker button.selected {
  border-color: rgba(244, 198, 108, 0.6);
  color: var(--ink);
  background: linear-gradient(
    145deg,
    rgba(244, 198, 108, 0.14),
    rgba(169, 108, 255, 0.09)
  );
  box-shadow: 0 0 18px rgba(244, 198, 108, 0.05);
}
.picker-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  color: #1d102b;
  font-family: "Manrope", sans-serif;
  font-size: 10px;
  font-weight: 800;
}
.picker-avatar.all {
  color: #f3c9ed;
  background: rgba(238, 120, 188, 0.25);
  font-size: 17px;
  font-weight: 400;
}
.picker-avatar.p1 {
  background: #d7adff;
}
.picker-avatar.p2 {
  background: #aee3ff;
}
.picker-avatar.p3 {
  background: #9fe3c6;
}
.picker-avatar.p4 {
  background: #ffd699;
}
.selection-preview {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  min-height: 37px;
  margin-top: 14px;
  padding: 8px 10px;
  overflow: hidden;
  border-radius: 9px;
  color: var(--muted);
  background: rgba(118, 226, 186, 0.07);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selection-preview b {
  color: var(--green);
  font-weight: 600;
}
.selection-check {
  display: grid;
  place-items: center;
  flex: none;
  width: 19px;
  height: 19px;
  border-radius: 6px;
  color: #0d2b24;
  background: var(--green);
}
.setting-divider {
  height: 1px;
  margin: 21px 0 16px;
  background: var(--line);
}
.export-block {
  margin-top: 0;
}
.setting-card {
  padding: 0;
}
.setting-card + .setting-card {
  margin-top: 18px;
}
.zip-export-toggle {
  margin-top: 0;
}
.export-name-input {
  width: 100%;
  margin-top: 13px;
  padding: 10px 11px;
  border: 1px solid rgba(193, 160, 255, 0.18);
  border-radius: 9px;
  color: var(--ink);
  background: rgba(10, 6, 24, 0.42);
  font-size: 12px;
  outline: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}
.export-name-input::placeholder {
  color: var(--soft);
}
.export-name-input:focus {
  border-color: var(--purple);
  box-shadow: 0 0 0 3px rgba(169, 108, 255, 0.12);
}
.export-name-input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
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
  font-size: 14px;
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
.compat-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 17px;
  color: var(--soft);
  font-size: 11px;
  line-height: 1.6;
}
.compat-note svg {
  flex: none;
  margin-top: 2px;
  color: var(--green);
}
.export-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  margin-top: 21px;
  padding: 13px 15px;
  border: 0;
  border-radius: 11px;
  color: #21112c;
  background: linear-gradient(110deg, #d6a5ff, #ef83c1 58%, #f4c66c);
  box-shadow:
    0 9px 25px rgba(198, 100, 220, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.45);
  font-size: 13px;
  font-weight: 800;
  transition: 0.18s ease;
}
.action-row {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 21px;
}
.share-circle-button {
  display: grid;
  place-items: center;
  flex: none;
  width: 46px;
  height: 46px;
  border: 1px solid rgba(118, 226, 186, 0.35);
  border-radius: 50%;
  color: var(--green);
  background: rgba(118, 226, 186, 0.09);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  transition: 0.18s ease;
}
.share-circle-button:hover:not(:disabled) {
  border-color: var(--green);
  background: rgba(118, 226, 186, 0.17);
  transform: translateY(-1px);
}
.share-circle-button:disabled {
  box-shadow: none;
}
.action-row .export-button {
  flex: 1;
  margin-top: 0;
}
.export-button:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.08);
  box-shadow:
    0 12px 30px rgba(198, 100, 220, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.45);
}
.export-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
  box-shadow: none;
}
.export-success {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 12px;
  color: var(--green);
  font-size: 11px;
}
.how-card {
  display: flex;
  gap: 12px;
  padding: 15px 16px;
  border: 1px solid rgba(193, 160, 255, 0.13);
  border-radius: 14px;
  background: rgba(28, 19, 53, 0.45);
}
.how-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  color: var(--purple-bright);
  background: rgba(169, 108, 255, 0.12);
}
.how-card strong {
  font-size: 12px;
}
.how-card p {
  margin: 5px 0 0;
  color: var(--soft);
  font-size: 11px;
  line-height: 1.6;
}

@media (max-width: 620px) {
  .settings-panel {
    padding: 18px;
  }
}
</style>
