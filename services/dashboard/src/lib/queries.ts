import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { SessionUser } from './types'

export const qk = {
  me: ['me'] as const,
  info: ['info'] as const,
  servers: ['servers'] as const,
  tools: (serverId: string) => ['servers', serverId, 'tools'] as const,
  users: ['users'] as const,
  myKeys: ['keys', 'mine'] as const,
  allKeys: ['keys', 'all'] as const,
  audit: (filters: object) => ['audit', filters] as const,
  stats: (hours: number) => ['stats', hours] as const,
  chatConfig: ['chat', 'config'] as const,
}

export function useMeQuery() {
  return useQuery({ queryKey: qk.me, queryFn: api.auth.me, staleTime: 60_000, retry: false })
}

/** Current user; only call inside routes guarded by <RequireAuth>. */
export function useSession(): SessionUser {
  const { data } = useMeQuery()
  if (!data) throw new Error('useSession used outside an authenticated route')
  return data
}

export function useIsAdmin(): boolean {
  return useSession().role === 'admin'
}

export function useInfo() {
  return useQuery({ queryKey: qk.info, queryFn: api.info, staleTime: 5 * 60_000 })
}

export function useServers(opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: qk.servers,
    queryFn: api.servers.list,
    refetchInterval: opts.poll ? 5000 : false,
  })
}
