import type { ComponentProps, CSSProperties } from 'react'
import { cx } from '../cx'

export type TopBarReveal = 'scroll' | 'always'

export interface TopBarRootProps extends ComponentProps<'header'> {
  /**
   * 'scroll'：页面顶部透明，滚动 revealDistance 像素内渐显为毛玻璃；'always'：常显。
   * @default 'scroll'
   */
  reveal?: TopBarReveal
  /** reveal="scroll" 时的渐显距离（px），写入 --rk-glass-reveal 供 animation-range 使用。 */
  revealDistance?: number
}

/**
 * 毛玻璃顶栏 Root：sticky 顶层条，材质与滚动渐显由 glass.css 的
 * data-glass="chrome" 提供（渐显只改模糊半径与底色 alpha，不用 opacity 淡入）。
 */
function TopBarRoot({
  reveal = 'scroll',
  revealDistance = 120,
  className,
  style,
  ...props
}: TopBarRootProps) {
  return (
    <header
      {...props}
      className={cx('rk-top-bar', className)}
      data-glass="chrome"
      data-reveal={reveal}
      style={
        {
          ...style,
          '--rk-glass-reveal': `${revealDistance}px`,
        } as CSSProperties
      }
    />
  )
}

export interface TopBarTitleProps extends ComponentProps<'div'> {}

/** 顶栏标题：单行省略，超长截断。 */
function TopBarTitle({ className, ...props }: TopBarTitleProps) {
  return <div {...props} className={cx('rk-top-bar__title', className)} />
}

export interface TopBarActionsProps extends ComponentProps<'div'> {}

/** 顶栏动作区：role="group"，靠右排列，accessible name 由调用方传 aria-label。 */
function TopBarActions({ className, ...props }: TopBarActionsProps) {
  return <div {...props} role="group" className={cx('rk-top-bar__actions', className)} />
}

export const TopBar = {
  Root: TopBarRoot,
  Title: TopBarTitle,
  Actions: TopBarActions,
}
