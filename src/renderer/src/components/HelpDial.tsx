import type { HelpMode } from '../ipc'

const OPTIONS: { id: HelpMode; label: string; hint: string }[] = [
  { id: 'hands-on', label: 'Hands On', hint: 'I do it for you' },
  { id: 'side-by-side', label: 'Side by Side', hint: 'I guide you through it' },
  { id: 'cheering', label: 'Cheering You On', hint: 'You do it, I coach' }
]

interface Props {
  mode: HelpMode
  onChange: (mode: HelpMode) => void
}

/** "How much help?" — pick how hands-on Clara is. */
export function HelpDial({ mode, onChange }: Props) {
  return (
    <div className="help-dial">
      <div className="help-dial-title">How much help?</div>
      <div className="help-dial-options">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            className={'help-opt' + (mode === o.id ? ' active' : '')}
            onClick={() => onChange(o.id)}
            aria-pressed={mode === o.id}
          >
            <span className="help-opt-label">{o.label}</span>
            <span className="help-opt-hint">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
