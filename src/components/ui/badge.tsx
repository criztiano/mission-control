'use client'

import { type ComponentPropsWithoutRef, type ReactElement } from 'react'
import { cn } from '@/lib/utils'

const variantStyles = {
  default: 'border-transparent bg-primary text-primary-foreground',
  secondary: 'border-transparent bg-secondary text-secondary-foreground',
  outline: 'text-foreground',
  destructive: 'border-transparent bg-red-500/15 text-red-400',
  error: 'border-transparent bg-red-500/15 text-red-400',
  info: 'border-transparent bg-blue-500/15 text-blue-400',
  success: 'border-transparent bg-emerald-500/15 text-emerald-400',
  warning: 'border-transparent bg-amber-500/15 text-amber-400',
} as const

const sizeStyles = {
  sm: 'text-[10px] px-1.5 py-px gap-1 [&_svg]:size-2.5',
  default: 'text-xs px-2.5 py-0.5 gap-1 [&_svg]:size-3',
  lg: 'text-sm px-3 py-1 gap-1.5 [&_svg]:size-3.5',
} as const

type BadgeVariant = keyof typeof variantStyles
type BadgeSize = keyof typeof sizeStyles

interface BadgeProps extends ComponentPropsWithoutRef<'span'> {
  variant?: BadgeVariant
  size?: BadgeSize
  render?: ReactElement
}

export function Badge({
  variant = 'secondary',
  size = 'default',
  className,
  render,
  children,
  ...props
}: BadgeProps) {
  const classes = cn(
    'inline-flex items-center rounded-md border font-semibold whitespace-nowrap transition-colors',
    variantStyles[variant],
    sizeStyles[size],
    className
  )

  if (render) {
    // Clone the render element with badge styling
    const { props: renderProps, ...rest } = render as any
    return {
      ...rest,
      props: {
        ...renderProps,
        className: cn(classes, renderProps?.className),
        children: children ?? renderProps?.children,
        ...props,
      },
    } as ReactElement
  }

  return (
    <span className={classes} {...props}>
      {children}
    </span>
  )
}
