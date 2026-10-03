import { Button as UIButton } from '@base-ui/react/button'
import type { ButtonProps as UIButtonProps } from '@base-ui/react/button'
import { cx } from '../cx.js'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps
  extends Omit<UIButtonProps, 'className' | 'variant'> {
  /** 视觉变体，默认 secondary（与 showcase .btn 默认一致）。 */
  variant?: ButtonVariant
  className?: string
}

/**
 * Rakko 按钮：Base UI Button 行为 + data-ripple 状态层。
 * ref 作为普通 prop 透传（React 19）。
 */
export function Button({
  variant = 'secondary',
  className,
  ...props
}: ButtonProps) {
  return (
    <UIButton
      {...props}
      data-ripple
      className={cx('rk-button', `rk-button--${variant}`, className)}
    />
  )
}

export interface IconButtonProps
  extends Omit<UIButtonProps, 'className' | 'aria-label' | 'pressed'> {
  /** 图标按钮必须携带可访问名称。 */
  'aria-label': string
  /** 切换型按钮状态，映射到 aria-pressed。 */
  pressed?: boolean
  className?: string
}

/**
 * Rakko 图标按钮：方形、中心 ripple；切换状态时用 aria-pressed 提供额外线索。
 */
export function IconButton({
  'aria-label': ariaLabel,
  pressed,
  className,
  ...props
}: IconButtonProps) {
  return (
    <UIButton
      {...props}
      aria-label={ariaLabel}
      data-ripple
      data-ripple-centered
      aria-pressed={pressed === undefined ? undefined : pressed ? 'true' : 'false'}
      className={cx('rk-icon-button', className)}
    />
  )
}
