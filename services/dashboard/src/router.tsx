import { createBrowserRouter, useRouteError } from 'react-router'
import { AppLayout } from './components/layout/AppLayout'
import { RequireAdmin, RequireAuth } from './components/layout/Guards'
import { AcceptInvitePage } from './pages/AcceptInvite'
import { AuditPage } from './pages/Audit'
import { KeysPage } from './pages/Keys'
import { LoginPage } from './pages/Login'
import { NotFoundPage } from './pages/NotFound'
import { OverviewPage } from './pages/Overview'
import { ServerDetailPage } from './pages/ServerDetail'
import { ServersPage } from './pages/Servers'
import { TeamPage } from './pages/Team'

function RouteError() {
  const error = useRouteError()
  const message = error instanceof Error ? error.message : 'Unexpected error'
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-semibold text-zinc-900">Something went wrong</p>
      <p className="max-w-md font-mono text-xs text-zinc-500">{message}</p>
      <a href="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
        Reload the dashboard
      </a>
    </div>
  )
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/invite/:token', element: <AcceptInvitePage />, errorElement: <RouteError /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'servers', element: <ServersPage /> },
          { path: 'servers/:id', element: <ServerDetailPage /> },
          // Chat pulls in the markdown renderer; load it on demand to keep the initial bundle small.
          { path: 'chat', lazy: () => import('./pages/Chat').then((m) => ({ Component: m.ChatPage })) },
          { path: 'keys', element: <KeysPage /> },
          { path: 'audit', element: <AuditPage /> },
          { element: <RequireAdmin />, children: [{ path: 'team', element: <TeamPage /> }] },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
