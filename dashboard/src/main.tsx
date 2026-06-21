import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

/** Show a message instead of a blank page if anything throws while rendering. */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#e6e8f0', fontFamily: 'system-ui' }}>
          <h2>The dashboard hit a rendering error.</h2>
          <pre style={{ whiteSpace: 'pre-wrap', opacity: 0.8 }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
