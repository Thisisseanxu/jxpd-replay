import { createHead } from "@unhead/vue/client";
import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import { routes } from "./router";
import "./styles/global.css";
import "./styles/page.css";

async function bootstrap() {
  const app = createApp(App);
  const router = createRouter({
    history: createWebHistory(),
    routes,
  });

  app.use(router);
  app.use(createHead());
  await router.isReady();
  app.mount("#app");
}

void bootstrap();
