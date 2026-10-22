import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface TabItem<T extends string> {
  id: T
  label: ReactNode
  count?: number
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div role="tablist" className={cn('flex gap-5 border-b border-zinc-200', className)}>
      {items.map((t) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              '-mb-px inline-flex items-center gap-2 border-b-2 pb-2.5 pt-1 text-sm font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
              active
                ? 'border-indigo-600 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[11px] tabular-nums',
                  active ? 'bg-indigo-50 text-indigo-700' : 'bg-zinc-100 text-zinc-600',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Compact pill-style segmented control (e.g. 24h / 7d). */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: ReactNode }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg bg-zinc-100 p-0.5" role="radiogroup">
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          role="radio"
          aria-checked={i.id === value}
          onClick={() => onChange(i.id)}
          className={cn(
            'h-7 rounded-md px-3 text-[13px] font-medium transition-all',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500',
            i.id === value ? 'bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-950/5' : 'text-zinc-500 hover:text-zinc-800',
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  )
}
