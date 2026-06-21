import type { AgentError, AgentResult } from '../hooks/useAgent'

interface Props {
  result: AgentResult | null
  error: AgentError | null
}

export function ResultView({ result, error }: Props) {
  if (error) {
    return (
      <div className="result error">
        <div className="result-summary">{error.message}</div>
      </div>
    )
  }
  if (!result) return null

  return (
    <div className="result">
      {result.verdict && (
        <div className={`verdict verdict-${result.verdict}`}>
          <span className="verdict-tag">{result.verdict}</span>
          {result.reason && <span className="verdict-reason">{result.reason}</span>}
        </div>
      )}
      {result.summary && <div className="result-summary">{result.summary}</div>}
      {result.screenshot && (
        <img
          className="result-shot"
          src={`data:image/png;base64,${result.screenshot}`}
          alt="Result screenshot"
        />
      )}
    </div>
  )
}
