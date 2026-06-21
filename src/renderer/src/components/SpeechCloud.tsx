interface Props {
  visible: boolean
  text?: string
}

/** A puffy speech cloud that trails up from Sunny's mouth. */
export function SpeechCloud({ visible, text }: Props) {
  if (!visible || !text) return null
  return (
    <div className="cloud">
      <div className="cloud-body">{text}</div>
      <span className="cloud-tail tail-1" />
      <span className="cloud-tail tail-2" />
    </div>
  )
}
