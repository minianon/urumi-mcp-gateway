import { useId } from 'react'
import { cn } from '../../lib/cn'

export function LogoMark({ className }: { className?: string }) {
  // Unique per instance: a duplicate id inside a display:none sidebar would blank out the gradient.
  const gradientId = `urumi-g${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gradientId})`} />
      <path d="M10 9v8a6 6 0 0 0 12 0V9" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="24.5" r="1.8" fill="#c7d2fe" />
    </svg>
  )
}

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <span className={cn('text-[15px] font-semibold tracking-tight', dark ? 'text-white' : 'text-zinc-900')}>
        Urumi Gateway
      </span>
    </div>
  )
}
