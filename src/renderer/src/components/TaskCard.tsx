import type { TaskState } from '../hooks/useChat'

interface Props {
  task: TaskState
}

/** The live (then frozen) progress of one computer-use task, shown in the chat. */
export function TaskCard({ task }: Props) {
  const active = task.status === 'thinking' || task.status === 'working'
  const shot = task.liveShot || task.screenshot

  return (
    <div className={`task-card task-${task.status}`}>
      {active && (
        <div className="control-banner">
          <span className="dot" aria-hidden="true" /> Clara is using your computer…
        </div>
      )}

      {task.steps.length > 0 && (
        <ul className="steps">
          {task.steps.slice(-4).map((s) => (
            <li className="step" key={s.n}>
              <span className="step-n">{s.n}</span>
              <span className="step-action">{s.action}</span>
              {s.detail && <span className="step-detail">{s.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      {active && task.steps.length === 0 && <div className="step muted">Taking a look…</div>}

      {shot && (
        <img
          className="task-shot"
          src={`data:image/png;base64,${shot}`}
          alt={active ? 'Live view of the screen' : 'Result screenshot'}
        />
      )}

      {task.status === 'done' && task.verdict && (
        <div className={`verdict verdict-${task.verdict}`}>
          <span className="verdict-tag">{task.verdict === 'approved' ? 'Done' : 'Not sure'}</span>
          {task.reason && <span className="verdict-reason">{task.reason}</span>}
        </div>
      )}

      {task.status === 'error' && task.errorMessage && (
        <div className="task-error">{task.errorMessage}</div>
      )}
      {task.status === 'cancelled' && <div className="task-error">Stopped.</div>}
    </div>
  )
}
