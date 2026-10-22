import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { qk } from '../../lib/queries'
import type { Server } from '../../lib/types'
import { useToast } from '../ui/Toast'

export function useServerActions() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const replace = (saved: Server) =>
    queryClient.setQueryData<Server[]>(qk.servers, (list) => list?.map((s) => (s.id === saved.id ? saved : s)))

  const toggle = useMutation({
    mutationFn: ({ server, enabled }: { server: Server; enabled: boolean }) =>
      api.servers.update(server.id, { enabled }),
    onMutate: async ({ server, enabled }) => {
      await queryClient.cancelQueries({ queryKey: qk.servers })
      const prev = queryClient.getQueryData<Server[]>(qk.servers)
      queryClient.setQueryData<Server[]>(qk.servers, (list) =>
        list?.map((s) =>
          s.id === server.id ? { ...s, enabled, status: enabled ? 'connecting' : 'disabled' } : s,
        ),
      )
      return { prev }
    },
    onSuccess: (saved, { enabled }) => {
      replace(saved)
      toast.success(enabled ? `${saved.name} enabled` : `${saved.name} disabled`)
    },
    onError: (err, { server }, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(qk.servers, ctx.prev)
      toast.error(`Could not update ${server.name}`, err)
    },
    onSettled: (_d, _e, { server }) => {
      void queryClient.invalidateQueries({ queryKey: qk.servers })
      void queryClient.invalidateQueries({ queryKey: qk.tools(server.id) })
    },
  })

  const refresh = useMutation({
    mutationFn: (server: Server) => api.servers.refresh(server.id),
    onSuccess: (saved) => {
      replace(saved)
      void queryClient.invalidateQueries({ queryKey: qk.tools(saved.id) })
      if (saved.status === 'connected') {
        toast.success(`${saved.name} refreshed`, `${saved.toolCount} tool${saved.toolCount === 1 ? '' : 's'} listed`)
      } else {
        toast.error(`${saved.name} is ${saved.status}`, saved.statusReason)
      }
    },
    onError: (err, server) => toast.error(`Could not refresh ${server.name}`, err),
  })

  const remove = useMutation({
    mutationFn: (server: Server) => api.servers.remove(server.id),
    onSuccess: (_r, server) => {
      queryClient.setQueryData<Server[]>(qk.servers, (list) => list?.filter((s) => s.id !== server.id))
      queryClient.removeQueries({ queryKey: qk.tools(server.id) })
      toast.success(`${server.name} removed`)
    },
    onError: (err, server) => toast.error(`Could not remove ${server.name}`, err),
  })

  return { toggle, refresh, remove }
}
