<template>
  <main class="app-shell share-code-page">
    <div class="ambient ambient-one" />
    <div class="ambient ambient-two" />

    <section class="workspace-heading">
      <div class="heading-lockup">
        <div class="brand-mark" aria-hidden="true">
          <img :src="logoUrl" alt="" />
        </div>
        <div class="heading-copy">
          <h1>输入分享码</h1>
          <p>输入不包含域名的分享码，打开对应的回放下载页。</p>
        </div>
      </div>
      <nav class="page-nav-group" aria-label="页面导航">
        <RouterLink class="page-nav" to="/share"
          >生成分享 <Right size="15" fill="currentColor"
        /></RouterLink>
        <RouterLink class="page-nav" to="/"
          >匿名化工具 <Right size="15" fill="currentColor"
        /></RouterLink>
      </nav>
    </section>

    <section class="share-code-content">
      <form class="panel share-code-card" @submit.prevent="resolveCode">
        <div class="share-code-icon">
          <ShareOne size="23" fill="currentColor" />
        </div>
        <h2>打开分享回放</h2>
        <p>分享码由 6 位字母或数字组成，区分大小写。</p>
        <label class="share-code-field">
          <span>分享码</span>
          <input
            v-model="code"
            type="text"
            inputmode="text"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            maxlength="6"
            placeholder="例如 4kP92a"
            aria-label="分享码"
          />
        </label>
        <button class="resolve-button" type="submit" :disabled="busy">
          <ShareOne size="17" fill="currentColor" />
          {{ busy ? "正在查找…" : "打开回放下载页" }}
          <Right size="16" fill="currentColor" />
        </button>
        <p v-if="error" class="resolve-error" role="alert">{{ error }}</p>
        <RouterLink class="back-link" to="/share">返回分享页</RouterLink>
      </form>
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
import { ref } from "vue";
import { useRouter } from "vue-router";
import { GithubOne, Right, ShareOne } from "@icon-park/vue-next";
import { resolveShareCode } from "./utils/replay-share";
import { sharePagePath } from "./utils/routes";

const router = useRouter();
const appVersion = __APP_VERSION__;
const logoUrl = `${import.meta.env.BASE_URL}logo.webp`;
const code = ref("");
const busy = ref(false);
const error = ref("");

async function resolveCode() {
  const value = code.value.trim();
  if (!value) {
    error.value = "请输入分享码";
    return;
  }

  busy.value = true;
  error.value = "";
  try {
    const result = await resolveShareCode(value);
    await router.push(sharePagePath("", `#/r/${result.token}`));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "无法打开这个分享码";
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.page-nav-group {
  display: flex;
  align-items: center;
  gap: 8px;
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
.share-code-content {
  display: grid;
  place-items: center;
  min-height: min(590px, calc(100vh - 190px));
  padding: 34px 0;
}
.share-code-card {
  display: grid;
  justify-items: center;
  width: min(510px, 100%);
  padding: clamp(24px, 6vw, 40px);
  text-align: center;
}
.share-code-card .panel-kicker {
  justify-self: stretch;
  text-align: left;
}
.share-code-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border: 1px solid rgba(169, 108, 255, 0.3);
  border-radius: 17px;
  color: var(--purple-bright);
  background: rgba(169, 108, 255, 0.12);
}
.share-code-card h2 {
  margin: 17px 0 0;
  color: var(--ink);
  font-size: clamp(24px, 5vw, 32px);
  letter-spacing: -0.04em;
}
.share-code-card > p {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.65;
}
.share-code-field {
  display: grid;
  gap: 8px;
  width: 100%;
  margin-top: 25px;
  color: var(--muted);
  font-size: 12px;
  text-align: left;
}
.share-code-field input {
  width: 100%;
  padding: 13px 14px;
  border: 1px solid rgba(193, 160, 255, 0.24);
  border-radius: 10px;
  color: var(--ink);
  background: rgba(9, 5, 21, 0.44);
  font-family: "Manrope", monospace;
  font-size: 20px;
  letter-spacing: 0.16em;
  text-align: center;
  text-transform: none;
  outline: none;
  transition: 0.18s ease;
}
.share-code-field input::placeholder {
  color: var(--soft);
  font-size: 15px;
  letter-spacing: 0.05em;
}
.share-code-field input:focus {
  border-color: var(--purple);
  box-shadow: 0 0 0 3px rgba(169, 108, 255, 0.12);
}
.resolve-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  margin-top: 14px;
  padding: 13px 15px;
  border: 0;
  border-radius: 11px;
  color: #261330;
  background: linear-gradient(110deg, #d6a5ff, #ef83c1 58%, #f4c66c);
  font-size: 13px;
  font-weight: 800;
  transition: 0.18s ease;
}
.resolve-button:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.06);
}
.resolve-button:disabled {
  cursor: wait;
  opacity: 0.6;
}
.resolve-error {
  color: #ff9db0 !important;
}
.back-link {
  margin-top: 18px;
  color: var(--muted);
  font-size: 12px;
  text-decoration: none;
}
.back-link:hover {
  color: var(--ink);
}

@media (max-width: 620px) {
  .page-nav-group {
    width: 100%;
  }
  .page-nav {
    flex: 1;
    justify-content: center;
  }
  .share-code-content {
    min-height: auto;
    padding: 25px 0 40px;
  }
}
</style>
