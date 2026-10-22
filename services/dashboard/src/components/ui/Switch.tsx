import { cn } from '../../lib/cn'

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  size = 'md',
  id,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** Accessible label (visually hidden). */
  label: string
  size?: 'sm' | 'md'
  id?: string
}) {
  const sm = size === 'sm'
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        sm ? 'h-4 w-7' : 'h-5 w-9',
        checked ? 'bg-indigo-600' : 'bg-zinc-300',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none inline-block rounded-full bg-white shadow-sm ring-0 transition-transform',
          sm ? 'size-3' : 'size-4',
          checked ? (sm ? 'translate-x-3.5' : 'translate-x-4.5') : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
