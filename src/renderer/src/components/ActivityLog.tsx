import type { AvatarState, Step } from '../hooks/useAgent'

interface Props {
  state: AvatarState
  running: boolean
  steps: Step[]
}

export function ActivityLog({ state, running, steps }: Props) {
  if (!running && steps.length === 0) return null

  return (
    <div className="activity">
      {running && (
        <div className="control-banner">
          <span className="dot" /> Shadow is controlling your computer
        </div>
      )}
      <ul className="steps">
        {state === 'thinking' && steps.length === 0 && (
          <li className="step muted">Thinking…</li>
        )}
        {steps.map((s) => (
          <li className="step" key={s.n}>
            <span className="step-n">{s.n}</span>
            <span className="step-action">{s.action}</span>
            {s.detail && <span className="step-detail">{s.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
