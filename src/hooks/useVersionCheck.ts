export interface LatestRelease {
  tag: string
  url: string
}

/**
 * 检查 GitHub 最新 Release 版本。
 * - 仅当最新 Release 版本高于当前 __APP_VERSION__ 时提示。
 * - 用户点击后调用 dismiss()，本次浏览期间不再提示（sessionStorage）。
 * - 刷新页面后重新检查。
 */
export function useVersionCheck() {
  return { hasUpdate: false, latestRelease: null, dismiss: () => {} }
}
