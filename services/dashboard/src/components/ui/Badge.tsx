import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type Tone = 'gray' | 'green' | 'red' | 'amber' | 'indigo' | 'purple' | 'blue'

const tones: Record<Tone, string> = {
  gray: 'bg-zinc-100 text-zinc-700 ring-zinc-500/15',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/15',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  purple: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
}

const dots: Record<Tone, string> = {
  gray: 'bg-zinc-400',
  green: 'bg-emerald-500',
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  indigo: 'bg-indigo-500',
  purple: 'bg-violet-500',
  blue: 'bg-sky-500',
}

export function Badge({
  tone = 'gray',
  dot = false,
  pulse = false,
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone
  dot?: boolean
  pulse?: boolean
  icon?: ReactNode
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {dot && (
        <span className="relative flex size-1.5">
          {pulse && (
            <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', dots[tone])} />
          )}
          <span className={cn('relative inline-flex size-1.5 rounded-full', dots[tone])} />
        </span>
      )}
      {icon}
      {children}
    </span>
  )
}
