import { Navigate, Outlet, useLocation } from 'react-router'
import { LoaderCircle } from 'lucide-react'
import { useMeQuery } from '../../lib/queries'
import { errorMessage } from '../../lib/api'
import { Button } from '../ui/Button'
import { Logo } from './Logo'

export function FullPageLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <LoaderCircle className="size-5 animate-spin text-zinc-400" aria-label="Loading" />
    </div>
  )
}

export function RequireAuth() {
  const location = useLocation()
  const me = useMeQuery()

  if (me.isPending) return <FullPageLoader />

  if (me.isError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <Logo />
        <div>
          <p className="text-sm font-medium text-zinc-900">Can't reach the gateway</p>
          <p className="mt-1 text-[13px] text-zinc-500">{errorMessage(me.error)}</p>
        </div>
        <Button onClick={() => me.refetch()} loading={me.isFetching}>
          Try again
        </Button>
      </div>
    )
  }

  if (!me.data) {
    const next = location.pathname + location.search
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />
  }

  return <Outlet />
}

export function RequireAdmin() {
  const me = useMeQuery()
  if (me.data?.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}
