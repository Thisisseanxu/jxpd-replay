import HomePage from "./views/HomePage.vue";
import { SHARE_CODE_PATH, SHARE_PATH } from "./utils/routes";

export const routes = [
  {
    path: "/",
    name: "回放匿名化工具",
    component: HomePage,
    meta: {
      title: "吉星派对 · 回放匿名化与分享",
      description: "在浏览器本地匿名化并安全分享吉星派对回放文件。",
      ssg: true,
    },
  },
  {
    path: SHARE_PATH,
    alias: `${SHARE_PATH}/`,
    name: "分享回放",
    component: () => import("./SharePage.vue"),
    meta: {
      title: "分享回放 | 吉星派对 Replay Lab",
      description: "上传回放文件，生成一个安全的临时分享链接。",
      ssg: true,
    },
  },
  {
    path: SHARE_CODE_PATH,
    alias: `${SHARE_CODE_PATH}/`,
    name: "输入分享码",
    component: () => import("./ShareCodePage.vue"),
    meta: {
      title: "输入分享码 | 吉星派对 Replay Lab",
      description: "输入分享码，打开对应的吉星派对回放下载页。",
      ssg: true,
    },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "网页未找到",
    component: () => import("./NotFoundPage.vue"),
    meta: {
      title: "网页未找到 | 吉星派对 Replay Lab",
      description: "你访问的地址不存在，或者这段分享链接已经失效。",
      robots: "noindex, nofollow",
      ssg: false,
    },
  },
];
