import { ViteSSG } from "vite-ssg";
import App from "./App.vue";
import { routes } from "./router";
import "./styles/global.css";
import "./styles/page.css";

export const createApp = ViteSSG(App, { routes });

export function includedRoutes(paths: string[]) {
  return paths.filter((path) =>
    routes.some((route) => route.path === path && route.meta.ssg === true),
  );
}
