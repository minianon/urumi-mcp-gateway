import { useEffect, useMemo, useRef, useState } from 'react'
import { formatNumber } from '../../lib/format'

export interface Bucket {
  t: number // epoch ms (start of hour)
  calls: number
  errors: number
}

const HOUR = 3_600_000
const HEIGHT = 220
const PAD = { top: 12, right: 8, bottom: 26, left: 40 }
const COLOR_OK = '#6366f1' // indigo-500
const COLOR_ERR = '#f43f5e' // rose-500 (validated pair: CVD ΔE 23.5)

/** Normalise API buckets onto a continuous hourly axis so quiet hours render as gaps, not missing bars. */
export function fillHourly(timeline: { bucket: string; calls: number; errors: number }[], hours: number): Bucket[] {
  const parsed = timeline.map((b) => ({ t: new Date(b.bucket).getTime(), calls: b.calls, errors: b.errors }))
  if (parsed.some((b) => Number.isNaN(b.t))) {
    // Unknown bucket format: render as-is in order.
    return parsed.map((b, i) => ({ ...b, t: i }))
  }
  const byHour = new Map<number, Bucket>()
  for (const b of parsed) {
    const key = Math.floor(b.t / HOUR) * HOUR
    const prev = byHour.get(key)
    byHour.set(key, { t: key, calls: (prev?.calls ?? 0) + b.calls, errors: (prev?.errors ?? 0) + b.errors })
  }
  const end = Math.floor(Date.now() / HOUR) * HOUR
  const start = end - (hours - 1) * HOUR
  const out: Bucket[] = []
  for (let t = start; t <= end; t += HOUR) out.push(byHour.get(t) ?? { t, calls: 0, errors: 0 })
  return out
}

function niceMax(v: number): number {
  if (v <= 4) return 4
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / exp
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * exp
}

/** Path for a rect with only the top corners rounded (data-end rounding, flat on the baseline). */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h))
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

export function CallsChart({ data, hours }: { data: Bucket[]; hours: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.floor(entry.contentRect.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const max = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.calls))), [data])
  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const n = Math.max(1, data.length)
  const step = plotW / n
  const barW = Math.max(1, Math.min(28, step * (n > 60 ? 0.72 : 0.62)))
  const radius = barW >= 6 ? 4 : barW / 2
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)

  const isTime = data.length > 0 && data[0]!.t > 1e11
  const labelEvery = hours <= 24 ? 4 : 24
  const fmtTick = (t: number) => {
    const d = new Date(t)
    return hours <= 24
      ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
  }
  const fmtFull = (t: number) =>
    new Date(t).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const hovered = hover !== null ? data[hover] : undefined
  const tooltipLeft = hover !== null ? PAD.left + step * hover + step / 2 : 0

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={`Hourly tool calls and errors over the last ${hours} hours`}
        onMouseLeave={() => setHover(null)}
        className="block"
      >
        {/* grid + y axis */}
        {ticks.map((v, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(v)}
              y2={y(v)}
              stroke={i === 0 ? '#d4d4d8' : '#f4f4f5'}
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-zinc-400 text-[10.5px] tabular-nums">
              {formatNumber(v)}
            </text>
          </g>
        ))}

        {/* bars */}
        {data.map((d, i) => {
          const x = PAD.left + step * i + (step - barW) / 2
          const ok = Math.max(0, d.calls - d.errors)
          const errH = d.calls > 0 ? (d.errors / max) * plotH : 0
          const okH = (ok / max) * plotH
          const gap = errH > 0 && okH > 0 ? Math.min(2, okH / 2) : 0
          const dim = hover !== null && hover !== i
          return (
            <g key={d.t} opacity={dim ? 0.45 : 1} style={{ transition: 'opacity 120ms' }}>
              {okH > 0 && (
                <path
                  d={
                    errH > 0
                      ? `M${x},${PAD.top + plotH}h${barW}v${-okH + gap}h${-barW}Z`
                      : topRounded(x, PAD.top + plotH - okH, barW, okH, radius)
                  }
                  fill={COLOR_OK}
                />
              )}
              {errH > 0 && (
                <path d={topRounded(x, PAD.top + plotH - okH - errH, barW, Math.max(errH, 1.5), radius)} fill={COLOR_ERR} />
              )}
            </g>
          )
        })}

        {/* x labels */}
        {isTime &&
          data.map((d, i) => {
            const dt = new Date(d.t)
            const show = hours <= 24 ? dt.getHours() % labelEvery === 0 : dt.getHours() === 0
            if (!show) return null
            return (
              <text
                key={`l${d.t}`}
                x={PAD.left + step * i + step / 2}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-zinc-400 text-[10.5px]"
              >
                {fmtTick(d.t)}
              </text>
            )
          })}

        {/* hit targets (full column height, wider than the mark) */}
        {data.map((d, i) => (
          <rect
            key={`h${d.t}`}
            x={PAD.left + step * i}
            y={PAD.top}
            width={step}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-36 -translate-x-1/2 rounded-lg bg-white px-3 py-2 text-xs shadow-lg shadow-zinc-950/10 ring-1 ring-zinc-950/10"
          style={{ left: Math.min(Math.max(tooltipLeft, 80), width - 80) }}
        >
          <p className="mb-1.5 font-medium text-zinc-900">{isTime ? fmtFull(hovered.t) : `Bucket ${hover! + 1}`}</p>
          <div className="space-y-1 text-zinc-600">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: COLOR_OK }} /> Calls
              </span>
              <span className="font-medium tabular-nums text-zinc-900">{formatNumber(hovered.calls)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: COLOR_ERR }} /> Errors
              </span>
              <span className="font-medium tabular-nums text-zinc-900">{formatNumber(hovered.errors)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function ChartLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-zinc-500">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm" style={{ background: COLOR_OK }} />
        Successful calls
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm" style={{ background: COLOR_ERR }} />
        Errors
      </span>
    </div>
  )
}
