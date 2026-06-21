import { useState } from 'react'

interface Props {
  running: boolean
  onRun: (instruction: string) => void
  onCancel: () => void
}

export function InstructionInput({ running, onRun, onCancel }: Props) {
  const [text, setText] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (running) return
    onRun(text)
  }

  return (
    <form className="input-bar" onSubmit={submit}>
      <input
        className="input-field"
        placeholder="Tell Shadow what to do…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={running}
        autoFocus
      />
      {running ? (
        <button type="button" className="btn btn-stop" onClick={onCancel}>
          Stop
        </button>
      ) : (
        <button type="submit" className="btn btn-run" disabled={!text.trim()}>
          Run
        </button>
      )}
    </form>
  )
}
