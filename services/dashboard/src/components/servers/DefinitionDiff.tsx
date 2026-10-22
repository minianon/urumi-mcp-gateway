import { useMemo } from 'react'
import { diffLines, diffWords, type DiffOp } from '../../lib/diff'
import { cn } from '../../lib/cn'
import { prettyJson } from '../../lib/format'

interface Row {
  left?: { text: string; changed: boolean }
  right?: { text: string; changed: boolean }
}

/** Pair consecutive del/add runs so the two columns line up. */
function toRows(ops: DiffOp[]): Row[] {
  const rows: Row[] = []
  let i = 0
  while (i < ops.length) {
    const op = ops[i]!
    if (op.type === 'same') {
      rows.push({ left: { text: op.text, changed: false }, right: { text: op.text, changed: false } })
      i++
      continue
    }
    const dels: string[] = []
    const adds: string[] = []
    while (i < ops.length && ops[i]!.type !== 'same') {
      const o = ops[i]!
      if (o.type === 'del') dels.push(o.text)
      else adds.push(o.text)
      i++
    }
    const n = Math.max(dels.length, adds.length)
    for (let k = 0; k < n; k++) {
      rows.push({
        left: dels[k] !== undefined ? { text: dels[k]!, changed: true } : undefined,
        right: adds[k] !== undefined ? { text: adds[k]!, changed: true } : undefined,
      })
    }
  }
  return rows
}

function ColumnHeader({ children, tone }: { children: string; tone: 'old' | 'new' }) {
  return (
    <div
      className={cn(
        'border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide',
        tone === 'old' ? 'border-red-100 bg-red-50/60 text-red-700' : 'border-emerald-100 bg-emerald-50/60 text-emerald-700',
      )}
    >
      {children}
    </div>
  )
}

function DescriptionDiff({ before, after }: { before: string; after: string }) {
  const ops = useMemo(() => diffWords(before, after), [before, after])
  return (
    <div className="grid grid-cols-1 overflow-hidden rounded-lg ring-1 ring-zinc-200 md:grid-cols-2">
      <div className="border-b border-zinc-200 md:border-b-0 md:border-r">
        <ColumnHeader tone="old">Approved description</ColumnHeader>
        <p className="whitespace-pre-wrap px-3 py-2.5 text-[13px] leading-relaxed text-zinc-700">
          {ops
            .filter((o) => o.type !== 'add')
            .map((o, i) =>
              o.type === 'del' ? (
                <del key={i} className="rounded-sm bg-red-100 text-red-800 decoration-red-400">
                  {o.text}
                </del>
              ) : (
                <span key={i}>{o.text}</span>
              ),
            )}
          {!before && <span className="italic text-zinc-400">(empty)</span>}
        </p>
      </div>
      <div>
        <ColumnHeader tone="new">Current description</ColumnHeader>
        <p className="whitespace-pre-wrap px-3 py-2.5 text-[13px] leading-relaxed text-zinc-700">
          {ops
            .filter((o) => o.type !== 'del')
            .map((o, i) =>
              o.type === 'add' ? (
                <ins key={i} className="rounded-sm bg-emerald-100 text-emerald-900 no-underline">
                  {o.text}
                </ins>
              ) : (
                <span key={i}>{o.text}</span>
              ),
            )}
          {!after && <span className="italic text-zinc-400">(empty)</span>}
        </p>
      </div>
    </div>
  )
}

function SchemaDiff({ before, after }: { before: unknown; after: unknown }) {
  const rows = useMemo(() => toRows(diffLines(prettyJson(before), prettyJson(after))), [before, after])
  const same = rows.every((r) => !r.left?.changed && !r.right?.changed)
  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
      <div className="grid grid-cols-2">
        <div className="border-r border-zinc-200">
          <ColumnHeader tone="old">Approved input schema</ColumnHeader>
        </div>
        <ColumnHeader tone="new">Current input schema</ColumnHeader>
      </div>
      {same ? (
        <p className="px-3 py-2.5 text-[13px] text-zinc-500">No changes to the input schema.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full table-fixed border-collapse font-mono text-[11.5px] leading-5">
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td
                    className={cn(
                      'whitespace-pre-wrap break-all border-r border-zinc-200 px-3 align-top',
                      r.left?.changed ? 'bg-red-50 text-red-800' : 'text-zinc-600',
                      !r.left && 'bg-zinc-50',
                    )}
                  >
                    {r.left ? (r.left.changed ? '- ' : '  ') + r.left.text : ''}
                  </td>
                  <td
                    className={cn(
                      'whitespace-pre-wrap break-all px-3 align-top',
                      r.right?.changed ? 'bg-emerald-50 text-emerald-900' : 'text-zinc-600',
                      !r.right && 'bg-zinc-50',
                    )}
                  >
                    {r.right ? (r.right.changed ? '+ ' : '  ') + r.right.text : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function DefinitionDiff({
  approved,
  current,
}: {
  approved: { description: string; inputSchema: unknown }
  current: { description: string; inputSchema: unknown }
}) {
  return (
    <div className="space-y-3">
      {approved.description === current.description ? (
        <p className="text-[13px] text-zinc-500">Description unchanged.</p>
      ) : (
        <DescriptionDiff before={approved.description ?? ''} after={current.description ?? ''} />
      )}
      <SchemaDiff before={approved.inputSchema} after={current.inputSchema} />
    </div>
  )
}
