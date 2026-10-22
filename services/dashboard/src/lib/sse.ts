import { CSRF_HEADER, handleUnauthorized, parseError } from './api'
import type { ChatEvent } from './types'

const KNOWN = new Set(['tool_call', 'tool_result', 'message', 'error', 'done'])

/**
 * POSTs to /api/chat and parses the text/event-stream response incrementally.
 * EventSource can't be used: it only does GET and can't send the CSRF header.
 */
export async function streamChat(
  body: { message: string; history?: unknown[] },
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      [CSRF_HEADER]: '1',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const err = await parseError(res)
    if (res.status === 401) handleUnauthorized()
    throw err
  }
  if (!res.body) throw new Error('Streaming responses are not supported by this browser')

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let eventName = 'message'
  let dataLines: string[] = []

  const dispatch = () => {
    const name = eventName
    eventName = 'message'
    if (dataLines.length === 0) return
    const raw = dataLines.join('\n')
    dataLines = []
    if (!KNOWN.has(name)) return
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      // Tolerate a plain-text payload for message / error events.
      data = name === 'error' ? { message: raw } : { content: raw }
    }
    onEvent({ type: name, data } as ChatEvent)
  }

  const processLine = (line: string) => {
    if (line === '') return dispatch()
    if (line.startsWith(':')) return // comment / keep-alive
    const idx = line.indexOf(':')
    const field = idx === -1 ? line : line.slice(0, idx)
    let value = idx === -1 ? '' : line.slice(idx + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') eventName = value || 'message'
    else if (field === 'data') dataLines.push(value)
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      const lines = buffer.split(/\r\n|\r|\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) processLine(line)
    }
    if (buffer) processLine(buffer)
    dispatch()
  } finally {
    reader.releaseLock()
  }
}
