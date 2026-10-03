// 与 design-system/src/tokens.css 的 --motion-* 一一对应，由 src/motion.test.ts 锁定同步。
export const MOTION = {
  tooltipDelayMs: 500,
  durationStateMs: 160,
  durationEnterMs: 240,
  durationExitMs: 180,
} as const

// motion.md：Snackbar 4 秒自动关闭；不是 tokens.css 的 token，因此不在 MOTION 内锁定。
export const SNACKBAR_TIMEOUT_MS = 4000

// CopyButton 成功态保持时长；不是 tokens.css 的 token，因此不在 MOTION 内锁定。
export const COPY_FEEDBACK_MS = 3000
