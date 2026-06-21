import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
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

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [healthy, setHealthy] = useState(false)
  const [agents, setAgents] = useState<AgentsResponse | null>(null)
  const [intents, setIntents] = useState<IntentsResponse | null>(null)
  const [space, setSpace] = useState<SpaceResponse | null>(null)

  const refetchSpace = useCallback(async () => {
    try {
      setSpace(await getSpace())
    } catch {
      /* keep last good state */
    }
  }, [])

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
  }, [])

  const stats = intents?.stats ?? { total: 0, ok: 0, awaiting: 0, routing: 0, failed: 0 }
  const spaceAddrs = new Set((space?.agents ?? []).map((a) => a.address))

  return (
    <div className="app">
      <Header health={health} healthy={healthy} />

      <div className="stats">
        <Stat cls="lead" n={space?.count ?? 0} k="In your space" />
        <Stat cls="route" n={stats.routing} k="In flight" />
        <Stat cls="ok" n={stats.ok} k="Completed" />
        <Stat cls="fail" n={stats.failed} k="Gated" />
      </div>

      <div className="grid">
        <div className="col">
          <MarketplacePanel spaceAddrs={spaceAddrs} onChanged={refetchSpace} />
        </div>
        <div className="col">
          <SpacePanel space={space} onChanged={refetchSpace} />
          <RoutesPanel agents={agents} />
          <IntentsPanel intents={intents} />
        </div>
      </div>
    </div>
  )
}

function Stat({ cls, n, k }: { cls: string; n: number; k: string }) {
  return (
    <div className={`stat ${cls}`}>
      <div className="n">{n}</div>
      <div className="k">{k}</div>
    </div>
  )
}

function Header({ health, healthy }: { health: Health | null; healthy: boolean }) {
  return (
    <div className="header">
      <div className="brand">
        <div className="brand-mark">
          <Icon name="lock" size={23} />
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

function PanelHead({ icon, title, meta }: { icon: 'globe' | 'shield' | 'branch' | 'activity'; title: string; meta?: React.ReactNode }) {
  return (
    <div className="panel-head">
      <h2>
        <span className="ico-tile">
          <Icon name={icon} size={16} />
        </span>
        {title}
      </h2>
      {meta != null && <span className="meta">{meta}</span>}
    </div>
  )
}

function MarketplacePanel({
  spaceAddrs,
  onChanged,
}: {
  spaceAddrs: Set<string>
  onChanged: () => void
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
      <PanelHead icon="globe" title="Marketplace" meta={loading ? 'searching…' : `${data?.num_hits ?? 0} live agents`} />
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
            aria-label="Search the marketplace"
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

        {data?.error && <div className="err">Couldn’t reach the marketplace: {data.error}</div>}

        <div className="mk-list">
          {loading && !data
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            : data?.agents.map((a) => (
                <MarketCard key={a.address} a={a} inSpace={spaceAddrs.has(a.address)} onChanged={onChanged} />
              ))}
        </div>
        {!loading && data && data.agents.length === 0 && (
          <div className="empty">No agents found for “{data.query}”.</div>
        )}

        <div className="gate-note">
          <span className="ico"><Icon name="shield" size={16} /></span>
          <span>
            Every agent here is <b>discoverable but untrusted</b> — usable as a planner the
            moment it appears, never granted execution. Irreversible actions still require
            your approval.
          </span>
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
        <div className="skel line" style={{ width: '90%', marginTop: 9 }} />
        <div className="skel line" style={{ width: '40%', marginTop: 9 }} />
      </div>
    </div>
  )
}

function Avatar({ src, flaky }: { src?: string; flaky?: boolean }) {
  const [ok, setOk] = useState(true)
  return src && ok ? (
    <img className={`mk-ava ${flaky ? 'flaky' : ''}`} src={src} alt="" onError={() => setOk(false)} />
  ) : (
    <div className={`mk-ava ${flaky ? 'flaky' : ''}`}>
      <Icon name="chip" size={18} />
    </div>
  )
}

function MarketCard({ a, inSpace, onChanged }: { a: MarketplaceAgent; inSpace: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const flaky = a.unresponsive || (!!a.status && a.status !== 'active')

  const add = async () => {
    setBusy(true)
    try {
      await registerAgent(a)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`mk-card ${inSpace ? 'in-space' : ''}`}>
      <Avatar src={a.avatar} flaky={flaky} />
      <div className="mk-main">
        <div className="mk-top">
          <span className="mk-name" title={a.name}>{a.name}</span>
          {a.featured && (
            <span className="tag featured"><Icon name="star" size={11} /> featured</span>
          )}
          {a.category && !a.featured && <span className="tag">{a.category}</span>}
        </div>
        {a.description && <div className="mk-desc">{a.description}</div>}
        <div className="mk-foot">
          <span className="meta-item" title="total interactions"><Icon name="zap" size={13} /> {nfmt(a.interactions)}</span>
          {a.rating != null && <span className="meta-item"><Icon name="star" size={13} /> {a.rating.toFixed(1)}</span>}
          <span className="mk-addr" title={a.address}>{shortAddr(a.address)}</span>
          {a.marketplace_url && (
            <a href={a.marketplace_url} target="_blank" rel="noreferrer">View <Icon name="arrowUpRight" size={13} /></a>
          )}
        </div>
      </div>
      {inSpace ? (
        <span className="add-btn added" title="In your space"><Icon name="check" size={14} /> Added</span>
      ) : (
        <button className="add-btn" onClick={add} disabled={busy} type="button">
          {busy ? <span className="spin" /> : <><Icon name="plus" size={14} /> Add</>}
        </button>
      )}
    </div>
  )
}

function SpacePanel({ space, onChanged }: { space: SpaceResponse | null; onChanged: () => void }) {
  const agents = space?.agents ?? []
  return (
    <div className="panel">
      <PanelHead icon="shield" title="Your space" meta={`${space?.count ?? 0} agents`} />
      <div className="panel-body">
        {agents.length === 0 && (
          <div className="empty">
            <span className="glyph"><Icon name="shield" size={22} /></span>
            No agents yet — add one from the marketplace to route intents through it.
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
  const [busy, setBusy] = useState(false)
  const [contract, setContract] = useState<ResolveResponse | null>(null)
  const [resolving, setResolving] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [readiness, setReadiness] = useState<Readiness>('checking')
  const [readyReason, setReadyReason] = useState('')
  const gate = s.policy.always_gate

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
          setReadyReason('Active, but no chat protocol — may not reply in chat.')
        } else {
          setReadiness('offline')
          setReadyReason(r.error || (r.found ? `Status: ${r.status}` : 'Inactive — not in the almanac.'))
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
        <Avatar src={s.avatar} flaky={flaky} />
        <div className="route-main">
          <div className="route-name">
            <span className="nm">{s.name}</span>
            {s.domain && <span className="kind planner">{s.domain}</span>}
            <span style={{ marginLeft: 'auto' }}>
              <ReadinessChip readiness={readiness} />
            </span>
          </div>
          <div className="route-sub">
            <span className={`gate-badge ${gate ? 'hard' : ''}`}>
              <Icon name="lock" size={13} /> {s.policy.summary}
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
        <button className={`icon-btn chat ${chatOpen ? 'on' : ''}`} onClick={() => setChatOpen((v) => !v)} type="button" title="Chat with this agent">
          <Icon name="message" size={16} />
        </button>
        <button className="icon-btn" onClick={inspect} disabled={resolving} type="button" title="Resolve contract">
          {resolving ? <span className="spin" /> : <Icon name="search" size={16} />}
        </button>
        <button className="icon-btn del" onClick={remove} disabled={busy} type="button" title="Remove from space">
          {busy ? <span className="spin" /> : <Icon name="trash" size={16} />}
        </button>
      </div>
      {contract && <ContractView c={contract} />}
      {chatOpen && <ChatBox address={s.address} onInspect={inspect} />}
    </div>
  )
}

function ReadinessChip({ readiness }: { readiness: Readiness }) {
  if (readiness === 'checking')
    return <span className="ready-chip checking"><span className="spin" /> checking</span>
  if (readiness === 'ready')
    return <span className="ready-chip ready"><Icon name="check" size={13} /> ready</span>
  if (readiness === 'typed')
    return <span className="ready-chip typed"><Icon name="alert" size={13} /> typed-only</span>
  return <span className="ready-chip offline"><Icon name="alert" size={13} /> may not respond</span>
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
          aria-label="Message to the agent"
        />
        <button onClick={send} disabled={busy} type="button">{busy ? <span className="spin" /> : 'Send'}</button>
      </div>
      {busy && <div className="loading"><span className="spin" /> posting intent — awaiting reply…</div>}
      {resp &&
        (resp.ok ? (
          <div className="chat-reply">
            <div className="chat-from"><Icon name="check" size={13} /> {resp.agent_name} replied</div>
            <div className="chat-text">{resp.reply}</div>
          </div>
        ) : /no reply|not reachable|did not respond|offline/i.test(resp.message || '') ? (
          <div className="chat-noreply">
            <span className="tag-line"><Icon name="alert" size={12} /> NO REPLY</span>
            <div className="lead">
              The agent didn’t answer in time. It’s reachable for lookups but its reply isn’t
              routing back — it may be slow, or the orchestrator’s return path needs a fresh
              public endpoint. Try again in a moment.
            </div>
          </div>
        ) : (
          <div className="chat-broken">
            <span className="tag-line"><Icon name="alert" size={12} /> NO VALID REPLY</span>
            <div className="lead">This agent looks broken — it returned a malformed reply.</div>
            {resp.message && <div className="raw">{resp.message}</div>}
            <span className="link" onClick={onInspect}><Icon name="search" size={12} /> resolve contract</span>
          </div>
        ))}
    </div>
  )
}

function ContractView({ c }: { c: ResolveResponse }) {
  if (c.error || !c.found) {
    return (
      <div className="contract">
        <span className="muted">Couldn’t resolve — {c.error || 'not found'}</span>
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
          <span className="ok-text">Speaks chat protocol — reachable with zero per-agent models</span>
        ) : (
          <span className="muted">Typed-only — needs manifest / README models</span>
        )}
      </div>
      {c.endpoint && (
        <div className="contract-line mk-addr" title={c.endpoint}>{c.endpoint}</div>
      )}
    </div>
  )
}

function RoutesPanel({ agents }: { agents: AgentsResponse | null }) {
  return (
    <div className="panel">
      <PanelHead icon="branch" title="Wired routes" meta={`${agents?.count ?? 0} active`} />
      <div className="panel-body">
        {!agents && <div className="loading"><span className="spin" /> loading routes…</div>}
        {agents?.agents.map((r) => (
          <div className="route-card" key={r.id}>
            <Avatar src={r.avatar} />
            <div className="route-main">
              <div className="route-name">
                <span className="nm">{r.name}</span>
                <span className={`kind ${r.type}`}>{r.type}</span>
              </div>
              <div className="route-sub">
                <span className="muted">on “{r.intent}”</span> · {r.domain}
                {r.interactions > 0 && <> · <Icon name="zap" size={12} style={{ verticalAlign: '-2px' }} /> {nfmt(r.interactions)}</>}
              </div>
            </div>
            <span className={`pill ${r.status === 'online' ? 'ok' : 'routing'}`}>{r.status}</span>
          </div>
        ))}
        {agents && agents.count === 0 && <div className="empty">No routes wired yet.</div>}
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
    <div className="testbar">
      <div className="label"><Icon name="send" size={14} /> Send a test intent through the gate</div>
      <div className="search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="order milk…" aria-label="Test intent" />
        <button onClick={fire} disabled={busy} type="button">{busy ? <span className="spin" /> : 'Run'}</button>
      </div>
      {last && <div className="result">{last}</div>}
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
      <PanelHead
        icon="activity"
        title="Intent feed"
        meta={
          <>
            <span>live · {rows.length}</span>
            {rows.length > 0 && (
              <button className="clear-btn" onClick={clear} disabled={clearing} type="button" title="Clear the intent feed">
                {clearing ? <span className="spin" /> : <><Icon name="trash" size={12} /> clear</>}
              </button>
            )}
          </>
        }
      />
      <div className="panel-body">
        {rows.length === 0 && (
          <div className="empty">No intents yet — send a test intent to watch it route through the gate.</div>
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
              <div className="intent-q" title={r.query}>{r.query}</div>
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
