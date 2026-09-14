import type { RouteLocationNormalizedLoaded } from "vue-router";

export const DEFAULT_TITLE = "吉星派对 · 回放匿名化与分享";
export const DEFAULT_DESCRIPTION =
  "在浏览器本地匿名化并安全分享吉星派对回放文件。";
export const DEFAULT_IMAGE_PATH = "/logo.webp";

function absoluteUrl(path: string) {
  const configuredOrigin = import.meta.env.VITE_SITE_ORIGIN;
  if (configuredOrigin) return new URL(path, configuredOrigin).href;
  if (!import.meta.env.SSR && typeof window !== "undefined") {
    return new URL(path, window.location.origin).href;
  }
  return path;
}

export function resolvePageMeta(route: RouteLocationNormalizedLoaded) {
  const title = metaString(route.meta.title, DEFAULT_TITLE);
  const description = metaString(route.meta.description, DEFAULT_DESCRIPTION);
  const image = metaString(route.meta.image, DEFAULT_IMAGE_PATH);
  const robots = metaString(route.meta.robots, "index,follow");
  const canonicalPath = route.path || "/";

  return {
    title,
    description,
    robots,
    image: absoluteUrl(image),
    canonical: absoluteUrl(canonicalPath),
  };
}

function metaString(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function createPageHead(route: RouteLocationNormalizedLoaded) {
  const meta = resolvePageMeta(route);

  return {
    title: meta.title,
    link: [
      {
        key: "canonical",
        rel: "canonical",
        href: meta.canonical,
      },
    ],
    meta: [
      {
        key: "description",
        name: "description",
        itemprop: "description",
        content: meta.description,
      },
      {
        key: "robots",
        name: "robots",
        content: meta.robots,
      },
      {
        key: "qq-name",
        id: "qq-share-name",
        name: "qq-share-name",
        itemprop: "name",
        content: meta.title,
      },
      {
        key: "qq-image",
        id: "qq-share-image",
        name: "qq-share-image",
        itemprop: "image",
        content: meta.image,
      },
      {
        key: "og-title",
        property: "og:title",
        content: meta.title,
      },
      {
        key: "og-description",
        property: "og:description",
        content: meta.description,
      },
      {
        key: "og-url",
        property: "og:url",
        content: meta.canonical,
      },
      {
        key: "og-image",
        property: "og:image",
        content: meta.image,
      },
      {
        key: "twitter-title",
        name: "twitter:title",
        content: meta.title,
      },
      {
        key: "twitter-description",
        name: "twitter:description",
        content: meta.description,
      },
      {
        key: "twitter-image",
        name: "twitter:image",
        content: meta.image,
      },
    ],
  };
}
