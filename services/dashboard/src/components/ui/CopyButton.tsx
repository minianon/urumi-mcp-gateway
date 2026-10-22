import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '../../lib/cn'

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  // Fallback for non-secure contexts (e.g. plain-http local clusters).
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(ta)
  return ok
}

export function CopyButton({
  value,
  label = 'Copy',
  showLabel = false,
  className,
  variant = 'light',
}: {
  value: string
  label?: string
  showLabel?: boolean
  className?: string
  variant?: 'light' | 'dark'
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(t)
  }, [copied])

  return (
    <button
      type="button"
      onClick={async () => setCopied(await copyText(value))}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      className={cn(
        'inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500',
        showLabel ? 'px-2' : 'w-7',
        variant === 'light'
          ? 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
          : 'text-zinc-400 hover:bg-white/10 hover:text-white',
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      {showLabel && (copied ? 'Copied' : label)}
    </button>
  )
}

export function CodeBlock({ code, title, className }: { code: string; title?: string; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg bg-zinc-950 ring-1 ring-zinc-900', className)}>
      <div className="flex items-center justify-between border-b border-white/5 py-1 pl-3.5 pr-1">
        <span className="font-mono text-[11px] text-zinc-500">{title ?? ''}</span>
        <CopyButton value={code} variant="dark" showLabel />
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-zinc-100">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/** Single-line value with inline copy button (URLs, prefixes, invite links). */
export function CopyField({ value, mono = true, className }: { value: string; mono?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-lg bg-zinc-50 py-1 pl-3 pr-1 ring-1 ring-inset ring-zinc-200',
        className,
      )}
    >
      <span className={cn('min-w-0 flex-1 truncate text-[13px] text-zinc-800', mono && 'font-mono text-[12.5px]')}>
        {value}
      </span>
      <CopyButton value={value} />
    </div>
  )
}
