interface Props {
  visible: boolean
  text?: string
}

export function SpeechBubble({ visible, text }: Props) {
  if (!visible || !text) return null
  return (
    <div className="speech-bubble">
      {text}
      <span className="speech-tail" />
    </div>
  )
}
