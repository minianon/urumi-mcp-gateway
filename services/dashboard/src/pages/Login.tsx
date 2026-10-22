import { useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { qk, useMeQuery } from '../lib/queries'
import { Button } from '../components/ui/Button'
import { Field, Input } from '../components/ui/Input'
import { FullPageLoader } from '../components/layout/Guards'
import { LogoMark } from '../components/layout/Logo'

/** Only allow same-app relative redirects (no open redirects). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) return '/'
  return next
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-zinc-50 px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,rgb(228_228_231)_1px,transparent_0)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-indigo-400/20 blur-3xl"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="size-10" />
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-zinc-500">{subtitle}</p>}
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl shadow-zinc-950/5 ring-1 ring-zinc-950/5">{children}</div>
        <p className="mt-6 text-center text-xs text-zinc-400">Urumi Gateway · one MCP endpoint for your whole team</p>
      </div>
    </div>
  )
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-[13px] text-red-700 ring-1 ring-inset ring-red-600/10">
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

export function LoginPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useMeQuery()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const login = useMutation({
    mutationFn: () => api.auth.login(email.trim(), password),
    onSuccess: ({ user }) => {
      queryClient.clear()
      queryClient.setQueryData(qk.me, user)
      navigate(next, { replace: true })
    },
  })

  if (me.isPending) return <FullPageLoader />
  if (me.data) return <Navigate to={next} replace />

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    login.mutate()
  }

  const error = login.error
    ? (login.error as { status?: number }).status === 401
      ? 'Incorrect email or password.'
      : errorMessage(login.error)
    : null

  return (
    <AuthShell title="Sign in to Urumi Gateway" subtitle="Manage your team's MCP servers, keys and audit trail.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <FormError>{error}</FormError>}
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={login.isPending} disabled={!email || !password}>
          Sign in
        </Button>
      </form>
      <p className="mt-5 border-t border-zinc-100 pt-4 text-center text-xs text-zinc-500">
        New here? Ask an admin for an invite link.
      </p>
    </AuthShell>
  )
}
