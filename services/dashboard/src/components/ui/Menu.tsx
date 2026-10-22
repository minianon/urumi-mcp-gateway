import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'

export interface MenuItem {
  label: ReactNode
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

/** Dropdown menu rendered in a portal so it is never clipped by scrolling tables. */
export function Menu({
  trigger,
  items,
  label,
  align = 'end',
}: {
  trigger: ReactNode
  items: MenuItem[]
  label: string
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const width = 208
    const left = align === 'end' ? r.right - width : r.left
    const estimatedHeight = items.length * 34 + 12
    const below = r.bottom + 4
    const top = below + estimatedHeight > window.innerHeight ? Math.max(8, r.top - estimatedHeight - 4) : below
    setPos({ top, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) })
  }, [open, align, items.length])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        btnRef.current?.focus()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])
        if (buttons.length === 0) return
        const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'ArrowDown' ? (idx + 1) % buttons.length : (idx - 1 + buttons.length) % buttons.length
        buttons[next]?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
          open && 'bg-zinc-100 text-zinc-900',
        )}
      >
        {trigger}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: pos.top, left: pos.left, width: 208 }}
            className="animate-pop-in fixed z-[55] rounded-xl bg-white p-1 shadow-lg shadow-zinc-950/10 ring-1 ring-zinc-950/10"
          >
            {items.map((item, i) => (
              <div key={i}>
                {item.separatorBefore && <div className="my-1 h-px bg-zinc-100" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false)
                    item.onSelect()
                  }}
                  className={cn(
                    'flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition-colors',
                    'focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-3.5',
                    item.danger
                      ? 'text-red-600 hover:bg-red-50 focus:bg-red-50'
                      : 'text-zinc-700 hover:bg-zinc-100 focus:bg-zinc-100 [&_svg]:text-zinc-400',
                  )}
                >
                  {item.icon}
                  {item.label}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
