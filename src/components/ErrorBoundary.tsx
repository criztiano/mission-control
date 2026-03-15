'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  name?: string
}

interface State {
  hasError: boolean
  error: Error | null
  retrying: boolean
  retryCount: number
}

/**
 * Error boundary with exponential backoff retry.
 *
 * Wraps critical components (ReactFlow, Charts) to prevent
 * network errors from crashing the entire page.
 *
 * Shows a user-friendly "Connection lost. Retrying..." UI
 * instead of a white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  private retryTimer: NodeJS.Timeout | null = null

  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, retrying: false, retryCount: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const name = this.props.name || 'Panel'
    console.error(`[${name}] Error boundary caught:`, error.message, errorInfo.componentStack?.slice(0, 300))
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
  }

  handleRetry = () => {
    this.setState({ retrying: true })

    // Exponential backoff: 1s, 2s, 4s
    const delay = Math.min(1000 * Math.pow(2, this.state.retryCount), 4000)

    this.retryTimer = setTimeout(() => {
      this.setState((prev) => ({
        hasError: false,
        error: null,
        retrying: false,
        retryCount: prev.retryCount + 1,
      }))
    }, delay)
  }

  handleManualRetry = () => {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.setState({ hasError: false, error: null, retrying: false, retryCount: 0 })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      const isNetworkError = this.state.error?.message?.includes('fetch') ||
        this.state.error?.message?.includes('Network') ||
        this.state.error?.message?.includes('Failed to load')

      return (
        <div className="flex flex-col items-center justify-center h-full min-h-[200px] p-8 text-center">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${
            this.state.retrying ? 'bg-yellow-500/10' : 'bg-destructive/10'
          }`}>
            {this.state.retrying ? (
              <svg className="w-6 h-6 text-yellow-500 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            {this.state.retrying
              ? 'Retrying...'
              : isNetworkError
                ? 'Connection lost'
                : 'Something went wrong'}
          </h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            {this.state.retrying
              ? `Attempt ${this.state.retryCount + 1}...`
              : isNetworkError
                ? 'This panel couldn\'t load its data. This usually resolves automatically.'
                : this.state.error?.message || 'An unexpected error occurred in this panel.'}
          </p>
          {!this.state.retrying && (
            <button
              onClick={this.handleManualRetry}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Try again
            </button>
          )}
          {this.state.retryCount > 0 && !this.state.retrying && (
            <p className="text-xs text-muted-foreground mt-2">
              Failed after {this.state.retryCount} {this.state.retryCount === 1 ? 'retry' : 'retries'}
            </p>
          )}
        </div>
      )
    }

    return this.props.children
  }
}
