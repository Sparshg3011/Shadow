import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  classify,
  clearIntents,
  getAgents,
  getHealth,
  getIntents,
  getSpace,
  registerAgent,
  removeAgent,
  resolveAgent,
  searchMarketplace,
  spaceChat,
} from './api'
import type {
  AgentsResponse,
  Health,
  IntentsResponse,
  MarketplaceAgent,
  MarketplaceResponse,
  ResolveResponse,
  SpaceAgent,
  SpaceChatResponse,
  SpaceResponse,
} from './types'

const QUICK = ['groceries', 'food delivery', 'payments', 'calendar', 'travel', 'amazon']
const POLL_MS = 2500

function shortAddr(a: string): string {
  if (!a) return ''
  return a.length > 18 ? `${a.slice(0, 10)}…${a.slice(-5)}` : a
}

function nfmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

// A turned-brass bolt seated in a steel race — the recurring Deadbolt motif.
function BoltGlyph({ size = 18, locked = false }: { size?: number; locked?: boolean }) {
  const color = locked ? 'var(--oxide)' : 'var(--brass)'
  const x = locked ? 10 : 3
  return (
    <svg width={size} height={(size * 14) / 24} viewBox="0 0 24 14" fill="none" aria-hidden="true">
      <rect x="0.5" y="3.5" width="23" height="7" rx="3.5" fill="var(--bg-soft)" stroke="var(--border)" />
      <rect x={x} y="5" width="11" height="4" rx="2" fill={color} />
      <rect x="20" y="4.5" width="3" height="5" rx="1" fill="var(--border)" />
    </svg>
  )
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthy, setHealthy] = useState(false)
  const [agents, setAgents] = useState<AgentsResponse | null>(null)
  const [intents, setIntents] = useState<IntentsResponse | null>(null)
  const [space, setSpace] = useState<SpaceResponse | null>(null)
  const [thrown, setThrown] = useState(false)
  const prevOk = useRef(0)
  const throwTimer = useRef<number | undefined>(undefined)

  // Fire the bolt: it throws to LOCKED, then eases back as the queue drains.
  const triggerThrow = useCallback(() => {
    setThrown(true)
    window.clearTimeout(throwTimer.current)
    throwTimer.current = window.setTimeout(() => setThrown(false), 1400)
  }, [])

  const refetchSpace = useCallback(async () => {
    try {
      setSpace(await getSpace())
    } catch {
      /* keep last good state */
    }
  }, [])

  // Poll health + routes + intent feed + space.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const h = await getHealth()
        if (!alive) return
        setHealth(h)
        setHealthy(true)
      } catch {
        if (alive) setHealthy(false)
      }
      try {
        const [a, i, s] = await Promise.all([getAgents(), getIntents(), getSpace()])
        if (!alive) return
        setAgents(a)
        setIntents(i)
        setSpace(s)
        // A real intent clearing the gate throws the bolt (never on raw cadence).
        if (i.stats.ok > prevOk.current && prevOk.current !== 0) triggerThrow()
        prevOk.current = i.stats.ok
      } catch {
        /* keep last good state */
      }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [triggerThrow])

  const stats = intents?.stats ?? { total: 0, ok: 0, awaiting: 0, routing: 0, failed: 0 }
  const spaceAddrs = new Set((space?.agents ?? []).map((a) => a.address))
  const inFlight = stats.routing + stats.awaiting

  return (
    <div className="app">
      <Header health={health} healthy={healthy} />

      <BoltBar thrown={thrown} inFlight={inFlight} />

      <div className="stats">
        <div className="stat">
          <div className="n">{space?.count ?? 0}</div>
          <div className="k">Seated</div>
        </div>
        <div className="stat route">
          <div className="n">{stats.routing}</div>
          <div className="k">In flight</div>
        </div>
        <div className="stat ok">
          <div className="n">{stats.ok}</div>
          <div className="k">Cleared</div>
        </div>
        <div className="stat fail">
          <div className="n">
            <BoltGlyph size={16} locked /> {stats.failed}
          </div>
          <div className="k">Held</div>
        </div>
      </div>

      <div className="grid">
        <div>
          <MarketplacePanel spaceAddrs={spaceAddrs} onChanged={refetchSpace} onThrow={triggerThrow} />
        </div>
        <div>
          <SpacePanel space={space} onChanged={refetchSpace} />
          <RoutesPanel agents={agents} />
          <IntentsPanel intents={intents} />
        </div>
      </div>
    </div>
  )
}

function BoltBar({ thrown, inFlight }: { thrown: boolean; inFlight: number }) {
  return (
    <div className="boltbar" data-thrown={thrown} aria-label={thrown ? 'gate locked — intent cleared' : 'gate open'}>
      <span className="boltbar-label left">Unlocked</span>
      <div className="bolt-race" style={{ '--throw': thrown ? 'calc(100% - 128px)' : '0px' } as CSSProperties}>
        <div className="bolt" />
        <div className="bolt-keeper" />
      </div>
      <span className="boltbar-label right">Locked</span>
      <span className="boltbar-count mono">{inFlight} in flight</span>
    </div>
  )
}

function Header({ health, healthy }: { health: Health | null; healthy: boolean }) {
  return (
    <div className="header">
      <div className="brand">
        <div className="brand-mark">
          <BoltGlyph size={26} />
        </div>
        <div>
          <h1>Deadbolt</h1>
          <div className="tagline">
            Agent control plane · <b>the agents plan, the gate decides</b>
          </div>
        </div>
      </div>
      <div className="health">
        <div className="health-node">
          <div className="label">Orchestrator</div>
          <div className="val">{health ? shortAddr(health.agent_address) : '—'}</div>
        </div>
        <span className={`dot ${healthy ? 'up' : ''}`} title={healthy ? 'online' : 'offline'} />
      </div>
    </div>
  )
}

function MarketplacePanel({
  spaceAddrs,
  onChanged,
  onThrow,
}: {
  spaceAddrs: Set<string>
  onChanged: () => void
  onThrow: () => void
}) {
  const [query, setQuery] = useState('groceries')
  const [input, setInput] = useState('groceries')
  const [data, setData] = useState<MarketplaceResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const reqId = useRef(0)

  const run = useCallback(async (q: string) => {
    const id = ++reqId.current
    setLoading(true)
    setQuery(q)
    try {
      const res = await searchMarketplace(q, 12)
      if (id === reqId.current) setData(res)
    } catch (e) {
      if (id === reqId.current)
        setData({ query: q, agents: [], total: 0, num_hits: 0, error: String(e) })
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    run('groceries')
  }, [run])

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          <span className="ico">🛰️</span> Fetch.ai Marketplace
        </h2>
        <span className="meta">{loading ? 'searching…' : `${data?.num_hits ?? 0} live agents`}</span>
      </div>
      <div className="panel-body">
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault()
            run(input.trim())
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search Agentverse — groceries, payments, travel…"
          />
          <button type="submit">Search</button>
        </form>
        <div className="chips">
          {QUICK.map((q) => (
            <span
              key={q}
              className={`chip ${query === q ? 'active' : ''}`}
              onClick={() => {
                setInput(q)
                run(q)
              }}
            >
              {q}
            </span>
          ))}
        </div>

        {data?.error && <div className="err">Marketplace error: {data.error}</div>}

        <div className="mk-list">
          {loading && !data
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            : data?.agents.map((a) => (
                <MarketCard
                  key={a.address}
                  a={a}
                  inSpace={spaceAddrs.has(a.address)}
                  onChanged={onChanged}
                  onThrow={onThrow}
                />
              ))}
        </div>
        {!loading && data && data.agents.length === 0 && (
          <div className="empty">No agents found for “{data.query}”.</div>
        )}

        <div className="gate-note">
          Every agent here is <b>discoverable but untrusted</b> — usable as a
          planner the moment it appears, never granted execution. Irreversible
          actions still stop at the bolt.
        </div>
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="mk-card skeleton">
      <div className="skel ava" />
      <div className="mk-main">
        <div className="skel line" style={{ width: '55%' }} />
        <div className="skel line" style={{ width: '90%', marginTop: 8 }} />
        <div className="skel line" style={{ width: '40%', marginTop: 8 }} />
      </div>
    </div>
  )
}

function MarketCard({
  a,
  inSpace,
  onChanged,
  onThrow,
}: {
  a: MarketplaceAgent
  inSpace: boolean
  onChanged: () => void
  onThrow: () => void
}) {
  const [imgOk, setImgOk] = useState(true)
  const [busy, setBusy] = useState(false)
  const flaky = a.unresponsive || (!!a.status && a.status !== 'active')

  const add = async () => {
    setBusy(true)
    try {
      await registerAgent(a)
      onThrow() // an agent crosses the gate into your space
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`mk-card ${inSpace ? 'in-space' : ''}`}>
      {a.avatar && imgOk ? (
        <img className={`mk-ava ${flaky ? 'flaky' : ''}`} src={a.avatar} alt="" onError={() => setImgOk(false)} />
      ) : (
        <div className={`mk-ava ${flaky ? 'flaky' : ''}`}>🤖</div>
      )}
      <div className="mk-main">
        <div className="mk-top">
          <span className="mk-name" title={a.name}>
            {a.name}
          </span>
          {a.featured && <span className="tag featured">★ featured</span>}
          {a.category && !a.featured && <span className="tag">{a.category}</span>}
        </div>
        {a.description && <div className="mk-desc">{a.description}</div>}
        <div className="mk-foot">
          <span title="total interactions">⚡ {nfmt(a.interactions)}</span>
          {a.rating != null && <span>★ {a.rating.toFixed(1)}</span>}
          <span className="mk-addr" title={a.address}>
            {shortAddr(a.address)}
          </span>
          {a.marketplace_url && (
            <a href={a.marketplace_url} target="_blank" rel="noreferrer">
              view ↗
            </a>
          )}
        </div>
      </div>
      {inSpace ? (
        <span className="add-btn added" title="In your space">
          <BoltGlyph size={13} /> Added
        </span>
      ) : (
        <button className="add-btn" onClick={add} disabled={busy} type="button">
          {busy ? <span className="spin" /> : '+ Add'}
        </button>
      )}
    </div>
  )
}

function SpacePanel({
  space,
  onChanged,
}: {
  space: SpaceResponse | null
  onChanged: () => void
}) {
  const agents = space?.agents ?? []
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          <span className="ico">🔐</span> Behind the Bolt
        </h2>
        <span className="meta">{space?.count ?? 0} seated</span>
      </div>
      <div className="panel-body">
        {agents.length === 0 && (
          <div className="empty">
            <BoltGlyph size={26} />
            Nothing seated yet — add an agent from the marketplace and it locks in here.
          </div>
        )}
        {agents.map((s) => (
          <SpaceCard key={s.address} s={s} onChanged={onChanged} />
        ))}
      </div>
    </div>
  )
}

type Readiness = 'checking' | 'ready' | 'typed' | 'offline'

function SpaceCard({ s, onChanged }: { s: SpaceAgent; onChanged: () => void }) {
  const [imgOk, setImgOk] = useState(true)
  const [busy, setBusy] = useState(false)
  const [contract, setContract] = useState<ResolveResponse | null>(null)
  const [resolving, setResolving] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [readiness, setReadiness] = useState<Readiness>('checking')
  const [readyReason, setReadyReason] = useState('')
  const gate = s.policy.always_gate

  // Auto-resolve on mount so readiness shows before any click (problem #1).
  useEffect(() => {
    let alive = true
    setReadiness('checking')
    resolveAgent(s.address)
      .then((r) => {
        if (!alive) return
        if (r.found && r.status === 'active' && r.speaks_chat) {
          setReadiness('ready')
          setReadyReason('')
        } else if (r.found && r.status === 'active') {
          setReadiness('typed')
          setReadyReason('active but no chat protocol — may not reply in chat')
        } else {
          setReadiness('offline')
          setReadyReason(r.error || (r.found ? `status: ${r.status}` : 'inactive — not in the almanac'))
        }
      })
      .catch((e) => {
        if (alive) {
          setReadiness('offline')
          setReadyReason(String(e))
        }
      })
    return () => {
      alive = false
    }
  }, [s.address])

  const remove = async () => {
    setBusy(true)
    try {
      await removeAgent(s.address)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const inspect = async () => {
    if (contract) {
      setContract(null)
      return
    }
    setResolving(true)
    try {
      setContract(await resolveAgent(s.address))
    } catch (e) {
      setContract({
        address: s.address, found: false, status: '', type: '', endpoint: '',
        protocols: [], protocol_count: 0, speaks_chat: false, error: String(e),
      })
    } finally {
      setResolving(false)
    }
  }

  const flaky = readiness === 'offline'

  return (
    <div className="space-wrap">
      <div className="route-card">
        {s.avatar && imgOk ? (
          <img className={`mk-ava ${flaky ? 'flaky' : ''}`} src={s.avatar} alt="" onError={() => setImgOk(false)} />
        ) : (
          <div className={`mk-ava ${flaky ? 'flaky' : ''}`}>🤖</div>
        )}
        <div className="route-main">
          <div className="route-name">
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.name}
            </span>
            {s.domain && <span className="kind planner">{s.domain}</span>}
            <span style={{ marginLeft: 'auto' }}>
              <ReadinessChip readiness={readiness} />
            </span>
          </div>
          <div className="route-sub">
            <span className={`gate-badge ${gate ? 'hard' : ''}`}>
              <BoltGlyph size={14} locked={gate} /> {s.policy.summary}
            </span>
          </div>
          {s.sample_decision && (
            <div className={`gate-ledger ${s.sample_decision === 'GATE' ? 'gate' : 'auto'}`}>
              {s.sample_decision === 'GATE'
                ? `GATE — ${s.sample_reason}`
                : `AUTO ≤ $${s.policy.auto_max_amount} — ${s.sample_reason}`}
            </div>
          )}
          {(readiness === 'typed' || readiness === 'offline') && readyReason && (
            <div className="ready-reason">{readyReason}</div>
          )}
        </div>
        <button
          className={`x-btn chat ${chatOpen ? 'on' : ''}`}
          onClick={() => setChatOpen((v) => !v)}
          type="button"
          title="Chat with this agent"
        >
          💬
        </button>
        <button className="x-btn" onClick={inspect} disabled={resolving} type="button" title="Resolve contract">
          {resolving ? <span className="spin" /> : '⌕'}
        </button>
        <button className="x-btn del" onClick={remove} disabled={busy} type="button" title="Remove from space">
          {busy ? <span className="spin" /> : '✕'}
        </button>
      </div>
      {contract && <ContractView c={contract} />}
      {chatOpen && <ChatBox address={s.address} onInspect={inspect} />}
    </div>
  )
}

function ReadinessChip({ readiness }: { readiness: Readiness }) {
  if (readiness === 'checking')
    return (
      <span className="ready-chip checking">
        <span className="spin scan" /> checking…
      </span>
    )
  if (readiness === 'ready') return <span className="ready-chip ready">✓ ready</span>
  if (readiness === 'typed') return <span className="ready-chip typed">⚠ typed-only</span>
  return <span className="ready-chip offline">⚠ may not respond</span>
}

function ChatBox({ address, onInspect }: { address: string; onInspect: () => void }) {
  const [msg, setMsg] = useState('I want to order a margherita pizza')
  const [busy, setBusy] = useState(false)
  const [resp, setResp] = useState<SpaceChatResponse | null>(null)

  const send = async () => {
    if (!msg.trim()) return
    setBusy(true)
    setResp(null)
    try {
      setResp(await spaceChat(address, msg.trim()))
    } catch (e) {
      setResp({ ok: false, address, agent_name: '', reply: '', message: String(e), deflected: false })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chatbox">
      <div className="search">
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Send an intent to this agent…"
        />
        <button onClick={send} disabled={busy} type="button">
          {busy ? <span className="spin" /> : 'Send'}
        </button>
      </div>
      {busy && <div className="loading">posting intent → awaiting agent reply…</div>}
      {resp &&
        (resp.ok ? (
          <div className="chat-reply">
            <div className="chat-from">↳ {resp.agent_name} replied</div>
            <div className="chat-text">{resp.reply}</div>
          </div>
        ) : /no reply|not reachable|did not respond|offline/i.test(resp.message || '') ? (
          <div className="chat-noreply">
            <span className="noreply-tag">NO REPLY</span>
            <div className="lead">
              The agent didn’t answer in time. It’s reachable for lookups but its reply
              isn’t routing back — it may be slow, or the orchestrator’s return path needs
              a fresh public endpoint. Try again in a moment.
            </div>
          </div>
        ) : (
          <div className="chat-broken">
            <span className="broken-tag">NO VALID REPLY</span>
            <div className="lead">This agent looks broken — it returned a malformed reply.</div>
            {resp.message && <div className="raw">{resp.message}</div>}
            <div style={{ marginTop: 6 }}>
              <a
                onClick={onInspect}
                style={{ color: 'var(--scan)', cursor: 'pointer', fontSize: 12 }}
              >
                resolve contract ↗
              </a>
            </div>
          </div>
        ))}
    </div>
  )
}

function ContractView({ c }: { c: ResolveResponse }) {
  if (c.error || !c.found) {
    return (
      <div className="contract">
        <span className="muted">⌕ couldn’t resolve — {c.error || 'not found'}</span>
      </div>
    )
  }
  return (
    <div className="contract">
      <div className="contract-row">
        <span className={`pill ${c.status === 'active' ? 'ok' : 'timeout'}`}>{c.status || 'unknown'}</span>
        <span className="muted">{c.type || 'agent'}</span>
        <span className="muted">· {c.protocol_count} protocol{c.protocol_count === 1 ? '' : 's'}</span>
      </div>
      <div className="contract-line">
        {c.speaks_chat ? (
          <span className="ok-text">✓ speaks chat protocol — reachable with zero per-agent models</span>
        ) : (
          <span className="muted">typed-only — needs manifest/README models</span>
        )}
      </div>
      {c.endpoint && (
        <div className="contract-line mk-addr" title={c.endpoint}>
          ↳ {c.endpoint}
        </div>
      )}
    </div>
  )
}

function RoutesPanel({ agents }: { agents: AgentsResponse | null }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          <span className="ico">🔗</span> Wired Routes
        </h2>
        <span className="meta">{agents?.count ?? 0} active</span>
      </div>
      <div className="panel-body">
        {!agents && <div className="loading">Loading routes…</div>}
        {agents?.agents.map((r) => (
          <div className="route-card" key={r.id}>
            {r.avatar ? (
              <img className="mk-ava" src={r.avatar} alt="" />
            ) : (
              <div className="mk-ava">🤖</div>
            )}
            <div className="route-main">
              <div className="route-name">
                {r.name}
                <span className={`kind ${r.type}`}>{r.type}</span>
              </div>
              <div className="route-sub">
                <span className="muted">on “{r.intent}”</span> · {r.domain}
                {r.interactions > 0 && <> · ⚡ {nfmt(r.interactions)}</>}
              </div>
            </div>
            <span className={`pill ${r.status === 'online' ? 'ok' : 'routing'}`}>
              {r.status}
            </span>
          </div>
        ))}
        {agents && agents.count === 0 && (
          <div className="empty">No routes wired yet.</div>
        )}
        <TestIntent />
      </div>
    </div>
  )
}

function TestIntent() {
  const [q, setQ] = useState('order 2 dozen eggs and milk from amazon')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<string | null>(null)

  const fire = async () => {
    setBusy(true)
    setLast(null)
    try {
      const r = await classify(q)
      setLast(`→ ${r.intent} · ${r.status}${r.products ? ` · ${r.products.length} products` : ''}`)
    } catch (e) {
      setLast(`error: ${e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-soft)' }}>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>
        ▶ Send a test intent through the gate
      </div>
      <div className="search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="order milk…" />
        <button onClick={fire} disabled={busy} type="button">
          {busy ? <span className="spin" /> : 'Run'}
        </button>
      </div>
      {last && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8, fontFamily: 'var(--mono)' }}>
          {last}
        </div>
      )}
    </div>
  )
}

function IntentsPanel({ intents }: { intents: IntentsResponse | null }) {
  const rows = intents?.intents ?? []
  const [clearing, setClearing] = useState(false)

  const clear = async () => {
    setClearing(true)
    try {
      await clearIntents()
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>
          <span className="ico">📡</span> Intent Feed
        </h2>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="meta">live · {rows.length}</span>
          {rows.length > 0 && (
            <button className="clear-btn" onClick={clear} disabled={clearing} type="button" title="Clear the intent feed">
              {clearing ? <span className="spin" /> : 'clear'}
            </button>
          )}
        </span>
      </div>
      <div className="panel-body">
        {rows.length === 0 && (
          <div className="empty">
            The line is quiet — run a test intent above to watch it cross the gate.
          </div>
        )}
        {rows.length > 0 && (
          <div className="intent-head">
            <span>seq</span>
            <span>query · origin · intent</span>
            <span>status</span>
          </div>
        )}
        {rows.map((r) => (
          <div className="intent-row" key={r.session_id}>
            <span className="seq">#{r.seq}</span>
            <div style={{ minWidth: 0 }}>
              <div className="intent-q" title={r.query}>
                {r.query}
              </div>
              <div className="intent-meta">
                {r.origin} · {r.intent || '—'}
                {r.product_count > 0 && ` · ${r.product_count} items`}
              </div>
            </div>
            <span className={`pill ${r.status}`}>{r.status.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
