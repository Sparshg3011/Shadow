const EXAMPLES = [
  'Open Notes and write "hello from Shadow"',
  'Take a screenshot',
  'Open Safari and go to apple.com'
]

interface Props {
  onPick: (instruction: string) => void
}

export function Suggestions({ onPick }: Props) {
  return (
    <div className="suggestions">
      {EXAMPLES.map((e) => (
        <button key={e} className="chip" onClick={() => onPick(e)}>
          {e}
        </button>
      ))}
    </div>
  )
}
