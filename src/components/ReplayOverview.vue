<template>
  <section class="panel preview-panel">
    <div class="preview-head">
      <div>
        <div class="panel-kicker">
          <span class="step-dot">02</span> 回放概览
        </div>
        <h2 v-if="!analysis">导入后显示回放信息</h2>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <span>房间名</span
        ><strong :title="analysis?.roomName || undefined">{{
          analysis?.roomName || "—"
        }}</strong>
      </div>
      <div class="stat-card">
        <span>回放帧</span
        ><strong>{{
          analysis ? analysis.frameCount.toLocaleString() : "—"
        }}</strong>
      </div>
      <div class="stat-card">
        <span>玩家</span
        ><strong>{{ analysis ? `${analysis.players.length} 位` : "—" }}</strong>
      </div>
    </div>

    <div class="player-list">
      <div class="list-label">本回放中的玩家</div>
      <template v-if="analysis?.players.length">
        <div
          v-for="(player, index) in analysis.players"
          :key="player.id.toString()"
          class="player-row"
          :class="{ 'is-revealed': revealPlayers.includes(index + 1) }"
        >
          <span class="player-avatar">{{ index + 1 }}</span>
          <span
            class="player-label"
            :title="player.originalName || `Player${index + 1}`"
            >{{ player.originalName || `Player${index + 1}` }}</span
          >
          <span class="player-name">{{
            revealPlayers.includes(index + 1)
              ? "保留真实昵称"
              : `匿名化为 Player${index + 1}`
          }}</span>
          <span v-if="revealPlayers.includes(index + 1)" class="reveal-tag"
            ><Check size="12" fill="currentColor" /> 保留</span
          >
          <span v-else class="anon-dot" />
        </div>
      </template>
      <div v-else class="empty-players">
        <Help size="16" fill="currentColor" /> 导入文件后会在这里显示玩家槽位
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Check, Help } from "@icon-park/vue-next";
import type { ReplayAnalysis } from "../utils/replay";

defineProps<{
  analysis: ReplayAnalysis | null;
  revealPlayers: number[];
}>();
</script>

<style scoped>
.preview-panel {
  padding: 22px;
}
.preview-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}
h2 {
  margin: 13px 0 0;
  color: var(--ink);
  font-size: 21px;
  letter-spacing: -0.03em;
}
.stats-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 9px;
  margin-top: 22px;
}
.stat-card {
  min-width: 0;
  padding: 12px 13px;
  border: 1px solid rgba(193, 160, 255, 0.11);
  border-radius: 11px;
  background: rgba(9, 5, 21, 0.25);
}
.stat-card span {
  display: block;
  overflow: hidden;
  color: var(--soft);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stat-card strong {
  display: block;
  overflow: hidden;
  margin-top: 6px;
  color: var(--ink);
  font-family: "Manrope", "Noto Sans SC", sans-serif;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.player-list {
  margin-top: 22px;
}
.list-label {
  margin-bottom: 8px;
  color: var(--soft);
  font-size: 12px;
}
.player-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(193, 160, 255, 0.1);
}
.player-row:last-child {
  border-bottom: 0;
}
.player-row.is-revealed {
  margin: 0 -1px;
  border: 1px solid rgba(244, 198, 108, 0.28);
  border-radius: 10px;
  background: rgba(244, 198, 108, 0.06);
}
.player-avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 27px;
  height: 27px;
  border-radius: 9px;
  color: #1d102b;
  font-family: "Manrope", sans-serif;
  font-size: 11px;
  font-weight: 800;
  background: linear-gradient(145deg, #dab1ff, #9661d9);
}
.player-label {
  min-width: 0;
  max-width: 44%;
  overflow: hidden;
  color: var(--ink);
  font-family: "Manrope", sans-serif;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.player-name {
  overflow: hidden;
  flex: 1;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reveal-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--gold);
  font-size: 11px;
}
.anon-dot {
  width: 6px;
  height: 6px;
  margin-right: 5px;
  border-radius: 50%;
  background: var(--purple);
  box-shadow: 0 0 8px rgba(169, 108, 255, 0.8);
}
.empty-players {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 18px 2px 2px;
  color: var(--soft);
  font-size: 12px;
}

@media (max-width: 620px) {
  .preview-panel {
    padding: 18px;
  }
}
</style>
