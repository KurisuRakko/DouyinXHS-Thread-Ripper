import { Menu as BaseMenu } from '@base-ui/react/menu'
import type { ComponentProps } from 'react'
import { cx } from '../cx.js'

export interface MenuPopupProps
  extends Omit<ComponentProps<typeof BaseMenu.Popup>, 'className'> {
  className?: string
}

/**
 * 组合 Portal > Positioner(sideOffset 6) > Popup：视觉类 rk-menu 落在 Popup 上。
 */
function MenuPopup({ className, children, ...props }: MenuPopupProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner sideOffset={6} className="rk-menu__positioner">
        <BaseMenu.Popup
          {...props}
          className={cx('rk-menu', className)}
          data-glass="panel"
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

export interface MenuItemProps
  extends Omit<ComponentProps<typeof BaseMenu.Item>, 'className'> {
  className?: string
}

function MenuItem({ className, ...props }: MenuItemProps) {
  return (
    <BaseMenu.Item {...props} data-ripple className={cx('rk-menu__item', className)} />
  )
}

export interface MenuSeparatorProps
  extends Omit<ComponentProps<typeof BaseMenu.Separator>, 'className'> {
  className?: string
}

function MenuSeparator({ className, ...props }: MenuSeparatorProps) {
  return (
    <BaseMenu.Separator
      {...props}
      className={cx('rk-menu__separator', className)}
    />
  )
}

export interface MenuGroupProps
  extends Omit<ComponentProps<typeof BaseMenu.Group>, 'className'> {
  className?: string
}

function MenuGroup({ className, ...props }: MenuGroupProps) {
  return <BaseMenu.Group {...props} className={className} />
}

export interface MenuGroupLabelProps
  extends Omit<ComponentProps<typeof BaseMenu.GroupLabel>, 'className'> {
  className?: string
}

function MenuGroupLabel({ className, ...props }: MenuGroupLabelProps) {
  return (
    <BaseMenu.GroupLabel
      {...props}
      className={cx('rk-menu__group-label', className)}
    />
  )
}

export const Menu = {
  Root: BaseMenu.Root,
  Trigger: BaseMenu.Trigger,
  Popup: MenuPopup,
  Item: MenuItem,
  Separator: MenuSeparator,
  Group: MenuGroup,
  GroupLabel: MenuGroupLabel,
}
