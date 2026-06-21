import { useAgent } from './hooks/useAgent'
import { InstructionInput } from './components/InstructionInput'
import { ActivityLog } from './components/ActivityLog'
import { ResultView } from './components/ResultView'

export default function App() {
  const agent = useAgent()

  return (
    <div className="app">
      <div className="stage">
        {/* M5 mounts the 3D avatar here; placeholder keeps the layout live. */}
        <div className={`avatar-placeholder state-${agent.state}`}>
          <div className="orb" />
          <span className="state-label">{agent.state}</span>
        </div>
      </div>

      <div className="panel">
        <ActivityLog state={agent.state} running={agent.running} steps={agent.steps} />
        <ResultView result={agent.result} error={agent.error} />
      </div>

      <InstructionInput running={agent.running} onRun={agent.run} onCancel={agent.cancel} />
    </div>
  )
}
