import { useAgent } from './hooks/useAgent'
import { InstructionInput } from './components/InstructionInput'
import { ActivityLog } from './components/ActivityLog'
import { ResultView } from './components/ResultView'
import { Scene } from './components/Scene'
import { SpeechBubble } from './components/SpeechBubble'
import { Suggestions } from './components/Suggestions'

export default function App() {
  const agent = useAgent()
  const idle = !agent.running && !agent.result && !agent.error

  return (
    <div className="app">
      <div className="drag-region" />

      <div className={`stage state-${agent.state}`}>
        <Scene state={agent.state} />
        <SpeechBubble visible={agent.state === 'talking'} text={agent.result?.summary} />
      </div>

      <div className="panel">
        <ActivityLog
          state={agent.state}
          running={agent.running}
          steps={agent.steps}
          current={agent.current}
        />
        <ResultView result={agent.result} error={agent.error} />
      </div>

      {idle && <Suggestions onPick={agent.run} />}
      <InstructionInput running={agent.running} onRun={agent.run} onCancel={agent.cancel} />
    </div>
  )
}
