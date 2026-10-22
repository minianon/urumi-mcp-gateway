import { Link } from 'react-router'
import { Page } from '../components/layout/PageHeader'

export function NotFoundPage() {
  return (
    <Page className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="font-mono text-sm font-medium text-indigo-600">404</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight text-zinc-900">Page not found</h1>
      <p className="mt-1 text-sm text-zinc-500">The page you're looking for doesn't exist or was moved.</p>
      <Link to="/" className="mt-6 text-sm font-medium text-indigo-600 hover:text-indigo-500">
        Back to overview
      </Link>
    </Page>
  )
}
