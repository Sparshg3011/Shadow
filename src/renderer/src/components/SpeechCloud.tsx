interface Props {
  visible: boolean
  text?: string
}

// Keep captions short enough that the bubble never grows into the avatar/mic.
// Sunny still speaks the full text aloud; this only bounds the on-screen caption.
const MAX_CHARS = 180

/** A speech bubble above Sunny's head with a large, readable caption. */
export function SpeechCloud({ visible, text }: Props) {
  if (!visible || !text) return null
  const shown =
    text.length > MAX_CHARS ? text.slice(0, MAX_CHARS).replace(/\s+\S*$/, '') + '…' : text
  return (
    <div className="cloud">
      <div className="cloud-body">{shown}</div>
      <span className="cloud-tail tail-1" />
      <span className="cloud-tail tail-2" />
    </div>
  )
}
