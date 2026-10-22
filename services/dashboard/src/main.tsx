import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError, isPublicPath, setUnauthorizedHandler } from './lib/api'
import { qk } from './lib/queries'
import { router } from './router'
import { ToastProvider } from './components/ui/Toast'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // Don't retry client errors (401/403/404/400…); retry transient failures once.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
        return failureCount < 1
      },
    },
    mutations: { retry: false },
  },
})

// Any 401 from the API (expired / revoked session) → drop cached data and go to /login.
setUnauthorizedHandler(() => {
  const { pathname, search } = window.location
  if (isPublicPath(pathname)) return
  queryClient.clear()
  queryClient.setQueryData(qk.me, null)
  const next = pathname + search
  void router.navigate(next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`, { replace: true })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
