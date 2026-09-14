<template>
  <main class="not-found-shell">
    <div class="ambient ambient-one" />
    <div class="ambient ambient-two" />

    <header class="not-found-header">
      <RouterLink
        class="brand-lockup"
        to="/"
        aria-label="返回吉星派对回放匿名化工具"
      >
        <span class="brand-mark" aria-hidden="true">
          <img :src="logoUrl" alt="" />
        </span>
        <span class="brand-copy">
          <strong>吉星派对</strong>
          <span>REPLAY LAB</span>
        </span>
      </RouterLink>
      <span class="error-chip">ERROR 404</span>
    </header>

    <section class="not-found-card" aria-labelledby="not-found-title">
      <div class="signal-line" aria-hidden="true">
        <span class="signal-dot" />
        <span class="signal-track" />
        <span class="signal-dot signal-dot-end" />
      </div>

      <p class="not-found-kicker">找不到该页面</p>
      <div class="not-found-code" aria-hidden="true">
        <span>4</span><span class="code-zero">0</span><span>4</span>
      </div>
      <h1 id="not-found-title">您访问的地址不存在</h1>
      <p class="not-found-description">
        请检查拼写，或回到主页继续处理你的回放！
      </p>

      <div class="not-found-actions">
        <a class="primary-action" href="/"
          >返回主页 <span aria-hidden="true">→</span></a
        >
      </div>
    </section>

    <footer class="not-found-footer">
      <span>吉星派对 Replay Lab</span>
      <span class="footer-divider" aria-hidden="true" />
      <span>本地处理 · 安全分享</span>
    </footer>
  </main>
</template>

<script setup lang="ts">
const logoUrl = `${import.meta.env.BASE_URL}logo.webp`;
</script>

<style scoped>
.not-found-shell {
  position: relative;
  isolation: isolate;
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
  overflow: hidden;
  padding: 0 clamp(20px, 5vw, 76px) 28px;
  background:
    radial-gradient(
      ellipse at 50% 42%,
      rgba(104, 47, 190, 0.2),
      transparent 42%
    ),
    radial-gradient(
      ellipse at 48% -12%,
      rgba(129, 58, 219, 0.27),
      transparent 46%
    ),
    linear-gradient(135deg, #0d0819 0%, #120b23 48%, #0e091b 100%);
}
.not-found-shell::before {
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
  mask-image: linear-gradient(to bottom, black, transparent 84%);
}
.ambient {
  position: absolute;
  z-index: -1;
  border-radius: 999px;
  pointer-events: none;
}
.ambient-one {
  width: 240px;
  height: 240px;
  top: 30%;
  left: -135px;
  background: rgba(122, 55, 225, 0.12);
  box-shadow: 0 0 100px 50px rgba(122, 55, 225, 0.08);
  filter: blur(2px);
}
.ambient-two {
  width: 210px;
  height: 210px;
  right: -115px;
  bottom: 16%;
  background: rgba(221, 94, 171, 0.08);
  box-shadow: 0 0 100px 50px rgba(221, 94, 171, 0.07);
  filter: blur(2px);
}
.not-found-header,
.not-found-footer {
  width: min(1220px, 100%);
  margin-inline: auto;
}
.not-found-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 82px;
  border-bottom: 1px solid rgba(193, 160, 255, 0.12);
}
.brand-lockup {
  display: inline-flex;
  align-items: center;
  gap: 11px;
  color: var(--ink);
  text-decoration: none;
}
.brand-mark {
  display: block;
  width: 48px;
  height: 48px;
}
.brand-mark img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.brand-copy {
  display: grid;
  gap: 3px;
}
.brand-copy strong {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.brand-copy span {
  color: var(--soft);
  font-family: "Manrope", sans-serif;
  font-size: 10px;
  letter-spacing: 0.08em;
}
.error-chip {
  padding: 7px 11px;
  border: 1px solid rgba(244, 198, 108, 0.28);
  border-radius: 999px;
  color: var(--gold);
  background: rgba(244, 198, 108, 0.07);
  font-family: "Manrope", sans-serif;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
}
.not-found-card {
  align-self: center;
  width: min(620px, 100%);
  margin: 50px auto;
  padding: clamp(28px, 6vw, 56px) clamp(24px, 7vw, 68px) 48px;
  border: 1px solid rgba(211, 177, 255, 0.2);
  border-radius: 24px;
  text-align: center;
  background:
    linear-gradient(145deg, rgba(42, 26, 77, 0.78), rgba(22, 14, 43, 0.9)),
    var(--panel);
  box-shadow:
    0 28px 90px rgba(0, 0, 0, 0.32),
    0 0 80px rgba(126, 64, 218, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.signal-line {
  display: flex;
  align-items: center;
  width: min(180px, 55%);
  margin: 0 auto 25px;
}
.signal-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: var(--gold);
  box-shadow: 0 0 14px rgba(244, 198, 108, 0.75);
}
.signal-dot-end {
  background: var(--purple-bright);
  box-shadow: 0 0 14px rgba(208, 165, 255, 0.75);
}
.signal-track {
  height: 1px;
  flex: 1;
  background: linear-gradient(
    90deg,
    rgba(244, 198, 108, 0.64),
    rgba(208, 165, 255, 0.62)
  );
}
.not-found-kicker {
  margin: 0;
  color: var(--gold);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.12em;
}
.not-found-code {
  display: flex;
  justify-content: center;
  margin: 3px 0 7px;
  color: var(--purple-bright);
  font-family: "Manrope", "Noto Sans SC", sans-serif;
  font-size: clamp(112px, 20vw, 176px);
  font-weight: 800;
  letter-spacing: -0.11em;
  line-height: 0.95;
  text-shadow: 0 0 30px rgba(169, 108, 255, 0.25);
}
.not-found-code span {
  display: block;
}
.not-found-code .code-zero {
  margin-inline: 5px 2px;
  color: var(--pink);
  text-shadow: 0 0 30px rgba(238, 120, 188, 0.24);
}
.not-found-card h1 {
  margin: 0;
  color: var(--ink);
  font-size: clamp(22px, 3vw, 30px);
  line-height: 1.25;
}
.not-found-description {
  max-width: 420px;
  margin: 13px auto 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.8;
}
.not-found-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 28px;
}
.not-found-actions a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  border-radius: 11px;
  font-size: 14px;
  font-weight: 800;
  text-decoration: none;
  transition: 0.18s ease;
}
.primary-action {
  gap: 9px;
  padding: 0 17px;
  color: #261330;
  background: linear-gradient(135deg, #e7b9ff, #b375ff);
  box-shadow: 0 10px 24px rgba(169, 108, 255, 0.2);
}
.primary-action:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 30px rgba(169, 108, 255, 0.3);
}
.primary-action span {
  font-size: 18px;
  line-height: 1;
}
.secondary-action {
  padding: 0 17px;
  border: 1px solid rgba(193, 160, 255, 0.24);
  color: var(--purple-bright);
  background: rgba(169, 108, 255, 0.08);
}
.secondary-action:hover {
  border-color: rgba(211, 177, 255, 0.45);
  color: var(--ink);
  background: rgba(169, 108, 255, 0.15);
}
.not-found-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 11px;
  padding-top: 17px;
  border-top: 1px solid rgba(193, 160, 255, 0.1);
  color: #5f5474;
  font-family: "Manrope", "Noto Sans SC", sans-serif;
  font-size: 10px;
  letter-spacing: 0.04em;
}
.footer-divider {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--gold);
  opacity: 0.72;
}
@media (max-width: 620px) {
  .not-found-shell {
    padding-inline: 15px;
  }
  .not-found-header {
    min-height: 72px;
  }
  .brand-mark {
    width: 42px;
    height: 42px;
  }
  .error-chip {
    padding-inline: 9px;
    font-size: 10px;
  }
  .not-found-card {
    margin: 32px auto;
    padding: 32px 20px 34px;
    border-radius: 20px;
  }
  .not-found-description {
    font-size: 14px;
  }
  .not-found-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .not-found-actions a {
    width: 100%;
  }
  .not-found-footer {
    flex-wrap: wrap;
    padding-bottom: 3px;
  }
}
</style>
