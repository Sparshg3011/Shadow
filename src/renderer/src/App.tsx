import { useAgent } from './hooks/useAgent'
import { Sunny, type SunnyState } from './components/Sunny'
import { SpeechCloud } from './components/SpeechCloud'
import { InstructionInput } from './components/InstructionInput'
import { ActivityLog } from './components/ActivityLog'
import { ResultView } from './components/ResultView'
import { Suggestions } from './components/Suggestions'

export default function App() {
  const agent = useAgent()
  const idle = !agent.running && !agent.result && !agent.error

  // Sunny "speaks" the most relevant line; large captions double as a re-readable record.
  const cloudText =
    agent.error?.message ||
    agent.result?.summary ||
    (agent.running ? agent.steps.at(-1)?.detail || agent.current || 'On it…' : '')
  const cloudVisible = agent.running || !!agent.result || !!agent.error

  // idle | thinking | talking map directly; happy when a task just succeeded.
  const sunnyState: SunnyState =
    agent.state === 'talking' && agent.result?.verdict === 'approved' ? 'happy' : agent.state

  return (
    <div className="app">
      <div className="sunny-stage">
        <div className="drag-region" />
        <SpeechCloud visible={cloudVisible} text={cloudText} />
        <Sunny state={sunnyState} />
      </div>

      {/* Controls live in a dock that reveals on hover — voice is the primary path. */}
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
    </div>
  )
}
