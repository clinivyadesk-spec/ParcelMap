import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Without this, a throw anywhere in the tree unmounts everything and leaves
 * the user staring at a blank page with their work apparently gone. Projects
 * live in localStorage, so reloading recovers them — say so.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ParcelMap] unhandled error', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        data-testid="app-error"
        className="flex h-full items-center justify-center p-8"
        role="alert"
      >
        <div className="max-w-lg space-y-3 rounded-xl bg-slate-900 p-6 ring-1 ring-rose-500/30">
          <h1 className="text-lg font-semibold text-rose-300">Something broke</h1>
          <p className="text-sm text-slate-300">
            ParcelMap hit an unexpected error. Your saved projects are stored in this browser and
            are not affected — reloading should bring everything back.
          </p>
          <pre className="max-h-40 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-400">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
