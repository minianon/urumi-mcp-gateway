import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowUp,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  SquarePen,
  Sparkles,
  Square,
  Wrench,
} from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { cn } from '../lib/cn'
import { formatMs, prettyJson } from '../lib/format'
import { qk, useSession } from '../lib/queries'
import { streamChat } from '../lib/sse'
import type { ChatEvent } from '../lib/types'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Skeleton } from '../components/ui/Skeleton'
import { initials } from '../lib/format'

interface ToolCallView {
  id: string
  name: string
  arguments: unknown
  status: 'running' | 'ok' | 'error'
  durationMs?: number
  preview?: unknown
}

type Turn =
  | { id: number; role: 'user'; content: string }
  | { id: number; role: 'assistant'; tools: ToolCallView[]; content: string; error?: string; done: boolean }

type AssistantTurn = Extract<Turn, { role: 'assistant' }>

const SUGGESTIONS = [
  'What orders came in today?',
  "Create a product called 'Urumi Hoodie' priced at 49.99",
  'Which supplier products are not in our store yet?',
  'Show the 5 best-selling products this month as a table',
]

/* ------------------------------------------------------------------ */

function ToolChip({ call }: { call: ToolCallView }) {
  const [open, setOpen] = useState(false)
  const previewText = call.preview === undefined ? '' : prettyJson(call.preview)
  const argsText = prettyJson(call.arguments)
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg bg-white ring-1 ring-inset transition-colors',
        call.status === 'error' ? 'ring-red-200' : 'ring-zinc-200',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-zinc-50"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-zinc-400" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-zinc-400" />
        )}
        <Wrench className="size-3.5 shrink-0 text-zinc-400" />
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-800">{call.name}</code>
        {call.status === 'running' ? (
          <span className="flex items-center gap-1 text-[11px] text-zinc-500">
            <LoaderCircle className="size-3.5 animate-spin text-indigo-500" /> running
          </span>
        ) : (
          <span
            className={cn(
              'flex items-center gap-1 text-[11px] font-medium',
              call.status === 'ok' ? 'text-emerald-700' : 'text-red-600',
            )}
          >
            {call.status === 'ok' ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
            {call.status === 'ok' ? 'ok' : 'error'}
            {call.durationMs !== undefined && (
              <span className="font-normal tabular-nums text-zinc-400">· {formatMs(call.durationMs)}</span>
            )}
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t border-zinc-100 bg-zinc-50/60 p-2.5">
          <div>
            <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-zinc-500">Arguments</p>
            <pre className="scroll-thin max-h-48 overflow-auto rounded-md bg-zinc-950 p-2.5 font-mono text-[11.5px] leading-relaxed text-zinc-200">
              {argsText || '{}'}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-zinc-500">Result preview</p>
            {call.status === 'running' ? (
              <p className="text-xs text-zinc-500">Waiting for the upstream server…</p>
            ) : (
              <pre
                className={cn(
                  'scroll-thin max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md p-2.5 font-mono text-[11.5px] leading-relaxed',
                  call.status === 'error' ? 'bg-red-50 text-red-800' : 'bg-white text-zinc-700 ring-1 ring-zinc-200',
                )}
              >
                {previewText || '(empty)'}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AssistantMessage({ turn }: { turn: AssistantTurn }) {
  const thinking = !turn.done && !turn.content && turn.tools.every((t) => t.status !== 'running')
  return (
    <div className="flex gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
        <Sparkles className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-3 pt-0.5">
        {turn.tools.length > 0 && (
          <div className="space-y-1.5">
            {turn.tools.map((t) => (
              <ToolChip key={t.id} call={t} />
            ))}
          </div>
        )}
        {thinking && (
          <div className="flex items-center gap-1.5 py-1 text-[13px] text-zinc-500">
            <span className="flex gap-1">
              <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-zinc-400" />
            </span>
            Thinking
          </div>
        )}
        {turn.content && (
          <div className="markdown">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
              }}
            >
              {turn.content}
            </Markdown>
          </div>
        )}
        {turn.error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-inset ring-red-600/10">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">{turn.error}</span>
          </div>
        )}
        {turn.done && !turn.content && !turn.error && (
          <p className="text-[13px] italic text-zinc-400">No answer was returned.</p>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export function ChatPage() {
  const user = useSession()
  const config = useQuery({ queryKey: qk.chatConfig, queryFn: api.chat.config, staleTime: 60_000 })
  const [turns, setTurns] = useState<Turn[]>([])
  const [history, setHistory] = useState<unknown[] | undefined>(undefined)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const nextId = useRef(1)

  useEffect(() => () => abortRef.current?.abort(), [])

  // Follow the stream while the user is near the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [turns])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [input])

  const updateAssistant = useCallback((id: number, fn: (t: AssistantTurn) => AssistantTurn) => {
    setTurns((list) => list.map((t) => (t.id === id && t.role === 'assistant' ? fn(t) : t)))
  }, [])

  const send = useCallback(
    async (text: string) => {
      const message = text.trim()
      if (!message || streaming) return
      const userTurn: Turn = { id: nextId.current++, role: 'user', content: message }
      const assistantId = nextId.current++
      setTurns((list) => [
        ...list,
        userTurn,
        { id: assistantId, role: 'assistant', tools: [], content: '', done: false },
      ])
      setInput('')
      setStreaming(true)
      stickRef.current = true
      const controller = new AbortController()
      abortRef.current = controller

      const onEvent = (ev: ChatEvent) => {
        switch (ev.type) {
          case 'tool_call':
            updateAssistant(assistantId, (t) => ({
              ...t,
              tools: [
                ...t.tools,
                { id: ev.data.id ?? `${ev.data.name}-${t.tools.length}`, name: ev.data.name, arguments: ev.data.arguments, status: 'running' },
              ],
            }))
            break
          case 'tool_result':
            updateAssistant(assistantId, (t) => {
              let idx = t.tools.findIndex((c) => c.id === ev.data.id)
              if (idx === -1) idx = t.tools.findIndex((c) => c.name === ev.data.name && c.status === 'running')
              const result = {
                status: ev.data.ok ? ('ok' as const) : ('error' as const),
                durationMs: ev.data.durationMs,
                preview: ev.data.preview,
              }
              if (idx === -1) {
                return { ...t, tools: [...t.tools, { id: ev.data.id, name: ev.data.name, arguments: undefined, ...result }] }
              }
              return { ...t, tools: t.tools.map((c, i) => (i === idx ? { ...c, ...result } : c)) }
            })
            break
          case 'message':
            updateAssistant(assistantId, (t) => ({
              ...t,
              content: t.content ? `${t.content}\n\n${ev.data.content ?? ''}` : (ev.data.content ?? ''),
            }))
            break
          case 'error':
            updateAssistant(assistantId, (t) => ({ ...t, error: ev.data.message || 'The agent reported an error' }))
            break
          case 'done':
            if (Array.isArray(ev.data.history)) setHistory(ev.data.history)
            updateAssistant(assistantId, (t) => ({ ...t, done: true }))
            break
        }
      }

      try {
        await streamChat({ message, ...(history ? { history } : {}) }, onEvent, controller.signal)
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError'
        updateAssistant(assistantId, (t) => ({
          ...t,
          error: aborted ? (t.error ?? 'Stopped.') : errorMessage(err),
        }))
      } finally {
        updateAssistant(assistantId, (t) => ({
          ...t,
          done: true,
          tools: t.tools.map((c) => (c.status === 'running' ? { ...c, status: 'error' as const, preview: c.preview ?? 'No result received' } : c)),
        }))
        abortRef.current = null
        setStreaming(false)
        textareaRef.current?.focus()
      }
    },
    [history, streaming, updateAssistant],
  )

  const reset = () => {
    abortRef.current?.abort()
    setTurns([])
    setHistory(undefined)
    setInput('')
    textareaRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send(input)
    }
  }

  const enabled = config.data?.enabled === true

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight text-zinc-900">Chat</h1>
          {config.data?.enabled && (
            <Badge tone="gray" icon={<Bot className="size-3" />} title={`${config.data.provider} · tool mode: ${config.data.toolMode}`}>
              <span className="font-mono text-[11px]">{config.data.model}</span>
            </Badge>
          )}
          {config.data?.enabled && (
            <span className="hidden text-xs text-zinc-400 sm:inline">
              Uses your permissions · calls are audited as <span className="font-medium text-zinc-500">Chat</span>
            </span>
          )}
        </div>
        {enabled && (
          <Button size="sm" icon={<SquarePen className="size-3.5" />} onClick={reset} disabled={turns.length === 0 && !streaming}>
            New chat
          </Button>
        )}
      </div>

      {config.isPending ? (
        <div className="mx-auto w-full max-w-3xl space-y-4 p-8">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : config.isError ? (
        <div className="p-8">
          <Card>
            <EmptyState
              icon={<CircleAlert />}
              title="Couldn't load chat settings"
              description={errorMessage(config.error)}
              action={<Button onClick={() => config.refetch()}>Retry</Button>}
            />
          </Card>
        </div>
      ) : !enabled ? (
        <div className="mx-auto w-full max-w-2xl p-6 lg:p-10">
          <Card>
            <EmptyState
              icon={<MessageSquare />}
              title="Chat isn't enabled on this gateway"
              description={
                <>
                  The built-in agent needs an LLM provider. An admin can enable it by configuring a provider and API key in
                  the gateway's Helm values. Meanwhile, you can use every tool from your own MCP client.
                </>
              }
              action={
                <Link to="/keys">
                  <span className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-3.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500">
                    <KeyRound className="size-4" /> Connect an MCP client
                  </span>
                </Link>
              }
            />
          </Card>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            }}
            className="scroll-thin min-h-0 flex-1 overflow-y-auto"
          >
            {turns.length === 0 ? (
              <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 py-10 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
                  <Sparkles className="size-5" />
                </div>
                <h2 className="mt-5 text-lg font-semibold tracking-tight text-zinc-900">
                  What can I help with, {user.name?.split(' ')[0] || 'there'}?
                </h2>
                <p className="mt-1.5 max-w-md text-sm text-zinc-500">
                  Ask in plain English. The agent calls your team's MCP tools through the gateway — the same tools, roles and
                  audit trail as any other client.
                </p>
                <div className="mt-7 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="rounded-xl bg-white px-3.5 py-3 text-left text-[13px] text-zinc-700 shadow-xs ring-1 ring-zinc-200 transition-all hover:-translate-y-px hover:text-zinc-900 hover:shadow-sm hover:ring-zinc-300"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
                {turns.map((t) =>
                  t.role === 'user' ? (
                    <div key={t.id} className="flex justify-end gap-3">
                      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-zinc-900 px-3.5 py-2 text-[14px] leading-relaxed text-white">
                        {t.content}
                      </div>
                      <div className="hidden size-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[11px] font-semibold text-zinc-600 sm:flex">
                        {initials(user.name, user.email)}
                      </div>
                    </div>
                  ) : (
                    <AssistantMessage key={t.id} turn={t} />
                  ),
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-zinc-200/70 bg-zinc-50/80 px-4 pb-4 pt-3 backdrop-blur sm:px-6">
            <form
              className="mx-auto max-w-3xl"
              onSubmit={(e) => {
                e.preventDefault()
                void send(input)
              }}
            >
              <div className="flex items-end gap-2 rounded-2xl bg-white p-2 shadow-sm ring-1 ring-zinc-200 focus-within:ring-2 focus-within:ring-indigo-500">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  autoFocus
                  placeholder="Ask about orders, products, suppliers…"
                  aria-label="Message"
                  className="max-h-[200px] min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
                />
                {streaming ? (
                  <Button
                    variant="subtle"
                    size="md"
                    className="w-9 rounded-xl px-0"
                    onClick={() => abortRef.current?.abort()}
                    aria-label="Stop generating"
                    title="Stop"
                  >
                    <Square className="size-3.5 fill-current" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    variant="primary"
                    className="w-9 rounded-xl px-0"
                    disabled={!input.trim()}
                    aria-label="Send message"
                    title="Send (Enter)"
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                )}
              </div>
              <p className="mt-1.5 text-center text-[11px] text-zinc-400">
                Enter to send · Shift+Enter for a new line · Write actions run for real against connected systems
              </p>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
