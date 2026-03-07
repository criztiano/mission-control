'use client'

import { type ComponentPropsWithoutRef, type ReactElement } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent font-medium outline-none transition-shadow [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        sm: 'h-4 min-w-[16px] px-[3px] text-[0.625rem] [&_svg]:size-2.5 rounded-[0.25rem]',
        default: 'h-[18px] min-w-[18px] px-[3px] text-xs [&_svg]:size-3',
        lg: 'h-[22px] min-w-[22px] px-[5px] text-sm [&_svg]:size-3.5',
      },
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'border-border bg-background text-foreground',
        destructive: 'bg-red-500/10 text-red-400',
        error: 'bg-red-500/10 text-red-400',
        info: 'bg-blue-500/10 text-blue-400',
        success: 'bg-emerald-500/10 text-emerald-400',
        warning: 'bg-amber-500/10 text-amber-400',
      },
    },
  }
)

interface BadgeProps
  extends ComponentPropsWithoutRef<'span'>,
    VariantProps<typeof badgeVariants> {
  render?: ReactElement
}

function Badge({ className, variant, size, render, children, ...props }: BadgeProps) {
  const classes = cn(badgeVariants({ className, size, variant }))

  if (render) {
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
    <span className={classes} data-slot="badge" {...props}>
      {children}
    </span>
  )
}

export { Badge, badgeVariants }
