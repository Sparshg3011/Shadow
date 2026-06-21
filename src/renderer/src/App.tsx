import { useEffect, useRef } from 'react'
import { useAgent } from './hooks/useAgent'
import { useVoice } from './voice/useVoice'
import { Sunny, type SunnyEmotion } from './components/Sunny'
import { SpeechCloud } from './components/SpeechCloud'
import { VoiceToggle } from './components/VoiceToggle'
import { InstructionInput } from './components/InstructionInput'
import { ActivityLog } from './components/ActivityLog'
import { ResultView } from './components/ResultView'
import { Suggestions } from './components/Suggestions'
import { EmotionGallery } from './components/EmotionGallery'

function emotionFor(agent: ReturnType<typeof useAgent>): SunnyEmotion {
  if (agent.error) return 'panic'
  if (agent.state === 'thinking') return 'thinking'
  if (agent.state === 'talking') {
    if (agent.result?.verdict === 'approved') return 'happy'
    if (agent.result?.verdict === 'rejected') return 'confused'
    return 'talking'
  }
  return 'idle'
}

export default function App() {
  // Dev: /?gallery shows every expression for visual review.
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('gallery')) {
    return <EmotionGallery />
  }

  const agent = useAgent()
  const voice = useVoice(agent.run)

  // Speak each new result aloud (only while voice is on).
  const spokenFor = useRef<string | null>(null)
  useEffect(() => {
    if (!voice.enabled) return
    const line = agent.error?.message || agent.result?.summary
    if (line && spokenFor.current !== line) {
      spokenFor.current = line
      voice.speak(line)
    }
  }, [agent.result, agent.error, voice.enabled])

  const idle = !agent.running && !agent.result && !agent.error

  // While Sunny is speaking, drive lip-sync from the live TTS amplitude.
  const emotion: SunnyEmotion = voice.speaking
    ? 'talking'
    : voice.listening && idle
      ? 'listening'
      : emotionFor(agent)

  const cloudText =
    (voice.listening && voice.caption) ||
    agent.error?.message ||
    agent.result?.summary ||
    (agent.running ? agent.steps.at(-1)?.detail || agent.current || 'On it…' : '')
  const cloudVisible = !!cloudText && (agent.running || !!agent.result || !!agent.error || !!voice.caption)

  return (
    <div className="app">
      <div className="sunny-stage">
        <div className="drag-region" />
        <SpeechCloud visible={cloudVisible} text={cloudText} />
        <Sunny emotion={emotion} amplitudeRef={voice.amplitudeRef} />
      </div>

      <div className="dock">
        <ActivityLog
          state={agent.state}
          running={agent.running}
          steps={agent.steps}
          current={agent.current}
        />
        <ResultView result={agent.result} error={agent.error} />
        {idle && <Suggestions onPick={agent.run} />}
        <InstructionInput running={agent.running} onRun={agent.run} onCancel={agent.cancel} />
      </div>

      <VoiceToggle
        enabled={voice.enabled}
        listening={voice.listening}
        speaking={voice.speaking}
        onToggle={voice.toggle}
      />
    </div>
  )
}
