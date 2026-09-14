export const ROOT_PATH = "/";
export const SHARE_PATH = "/share";
export const SHARE_CODE_PATH = "/share/code";

export function isKnownPath(pathname: string) {
  return (
    pathname === ROOT_PATH ||
    isSharePath(pathname) ||
    isShareCodePath(pathname)
  );
}

export function isSharePath(pathname: string) {
  return pathname === SHARE_PATH || pathname === `${SHARE_PATH}/`;
}

export function isShareCodePath(pathname: string) {
  return (
    pathname === SHARE_CODE_PATH ||
    pathname === `${SHARE_CODE_PATH}/`
  );
}

export function sharePagePath(search = "", hash = "") {
  return `${SHARE_PATH}${search}${hash}`;
}
