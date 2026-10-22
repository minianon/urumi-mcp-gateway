import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { ApiKey } from '../../lib/types'
import { useToast } from '../ui/Toast'

export function useRevokeKey() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (key: ApiKey) => api.keys.revoke(key.id),
    onSuccess: (_r, key) => {
      const now = new Date().toISOString()
      const mark = (list: ApiKey[] | undefined) => list?.map((k) => (k.id === key.id ? { ...k, revokedAt: now } : k))
      queryClient.setQueryData<ApiKey[]>(['keys', 'mine'], mark)
      queryClient.setQueryData<ApiKey[]>(['keys', 'all'], mark)
      void queryClient.invalidateQueries({ queryKey: ['keys'] })
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Key revoked', `${key.name} (${key.prefix}…) can no longer access the gateway`)
    },
    onError: (err, key) => toast.error(`Could not revoke ${key.name}`, err),
  })
}
