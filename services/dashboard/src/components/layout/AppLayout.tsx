import { useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  MessageSquare,
  ScrollText,
  Server as ServerIcon,
  Users,
  X,
} from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { initials } from '../../lib/format'
import { qk, useInfo, useServers, useSession } from '../../lib/queries'
import { useToast } from '../ui/Toast'
import { Logo } from './Logo'

interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ className?: string }>
  adminOnly?: boolean
  end?: boolean
}

const NAV: { section?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/servers', label: 'Servers', icon: ServerIcon },
      { to: '/chat', label: 'Chat', icon: MessageSquare },
    ],
  },
  {
    section: 'Access',
    items: [
      { to: '/keys', label: 'API keys', icon: KeyRound },
      { to: '/team', label: 'Team', icon: Users, adminOnly: true },
      { to: '/audit', label: 'Audit log', icon: ScrollText },
    ],
  },
]

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const user = useSession()
  const isAdmin = user.role === 'admin'
  const info = useInfo()
  const servers = useServers()
  const pendingReview = isAdmin ? (servers.data ?? []).reduce((n, s) => n + (s.pendingReviewCount || 0), 0) : 0
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()

  const logout = useMutation({
    mutationFn: api.auth.logout,
    onSettled: () => {
      queryClient.clear()
      queryClient.setQueryData(qk.me, null)
      navigate('/login', { replace: true })
    },
    onError: (err) => toast.error('Logout request failed', err),
  })

  return (
    <div className="flex h-full flex-col bg-zinc-950 text-zinc-300">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Logo dark />
      </div>

      <nav className="scroll-thin flex-1 space-y-6 overflow-y-auto px-3 py-3" aria-label="Main">
        {NAV.map((group, gi) => {
          const items = group.items.filter((i) => !i.adminOnly || isAdmin)
          if (items.length === 0) return null
          return (
            <div key={gi}>
              {group.section && (
                <p className="mb-1.5 px-2.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                  {group.section}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors',
                          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400',
                          isActive
                            ? 'bg-white/10 text-white'
                            : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon
                            className={cn(
                              'size-4 shrink-0',
                              isActive ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-zinc-300',
                            )}
                          />
                          <span className="flex-1">{item.label}</span>
                          {item.to === '/servers' && pendingReview > 0 && (
                            <span
                              className="rounded-full bg-amber-400/15 px-1.5 py-px text-[11px] font-semibold tabular-nums text-amber-300"
                              title={`${pendingReview} tool${pendingReview === 1 ? '' : 's'} need review`}
                            >
                              {pendingReview}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>

      <div className="shrink-0 border-t border-white/5 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white">
            {initials(user.name, user.email)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-zinc-100">{user.name || user.email}</p>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  'shrink-0 rounded px-1 py-px text-[10px] font-semibold uppercase leading-tight tracking-wide',
                  isAdmin ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/10 text-zinc-400',
                )}
              >
                {user.role}
              </span>
              <p className="truncate text-xs text-zinc-500">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200 disabled:opacity-50"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
        {info.data && (
          <p
            className="mt-2 truncate px-1.5 font-mono text-[10.5px] text-zinc-600"
            title={`Served by gateway pod ${info.data.pod}`}
          >
            v{info.data.version.replace(/^v/, '')} · {info.data.pod}
          </p>
        )}
      </div>
    </div>
  )
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setMobileOpen(false), [location.pathname])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">
        <Sidebar />
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="-ml-1.5 rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100"
          aria-label="Open navigation"
        >
          <MenuIcon className="size-5" />
        </button>
        <Logo />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="animate-fade-in absolute inset-0 bg-zinc-950/50" onClick={() => setMobileOpen(false)} />
          <div className="animate-slide-up absolute inset-y-0 left-0 w-64 shadow-2xl">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-2 top-3 rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white"
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <main className="lg:pl-60">
        <Outlet />
      </main>
    </div>
  )
}
