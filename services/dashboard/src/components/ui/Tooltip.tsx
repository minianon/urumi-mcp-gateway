import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'

/** Lightweight hover/focus tooltip rendered in a portal (never clipped by overflow containers). */
export function Tooltip({
  content,
  children,
  className,
  wide = false,
}: {
  content: ReactNode
  children: ReactNode
  className?: string
  wide?: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null)

  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const above = r.top > 80
    setPos({ x: r.left + r.width / 2, y: above ? r.top - 6 : r.bottom + 6, above })
  }
  const hide = () => setPos(null)

  if (content === undefined || content === null || content === '') return <>{children}</>

  return (
    <span
      ref={ref}
      className={cn('inline-flex min-w-0', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{
              left: Math.min(Math.max(pos.x, 12), window.innerWidth - 12),
              top: pos.y,
              transform: `translate(-50%, ${pos.above ? '-100%' : '0'})`,
            }}
            className={cn(
              'animate-fade-in pointer-events-none fixed z-[70] rounded-md bg-zinc-900 px-2 py-1 text-xs leading-snug text-zinc-50 shadow-lg',
              wide ? 'max-w-sm whitespace-pre-wrap break-words' : 'max-w-xs whitespace-nowrap',
            )}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  )
}
