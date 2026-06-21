import { useAgent } from './hooks/useAgent'
import { InstructionInput } from './components/InstructionInput'
import { ActivityLog } from './components/ActivityLog'
import { ResultView } from './components/ResultView'
import { Scene } from './components/Scene'
import { SpeechBubble } from './components/SpeechBubble'

export default function App() {
  const agent = useAgent()

  return (
    <div className="app">
      <div className={`stage state-${agent.state}`}>
        <Scene state={agent.state} />
        <SpeechBubble visible={agent.state === 'talking'} text={agent.result?.summary} />
      </div>

      <div className="panel">
        <ActivityLog state={agent.state} running={agent.running} steps={agent.steps} />
        <ResultView result={agent.result} error={agent.error} />
      </div>

      <InstructionInput running={agent.running} onRun={agent.run} onCancel={agent.cancel} />
    </div>
  )
}
