// Mirrors the orchestrator's dashboard Models (orchestrator/models.py).

export interface MarketplaceAgent {
  address: string
  name: string
  description: string
  category: string
  domain: string | null
  tags: string[]
  avatar: string
  rating: number | null
  interactions: number
  recent_interactions: number
  status: string
  unresponsive: boolean
  type: string
  featured: boolean
  handle: string
  success_rate: number | null
  marketplace_url: string
}

export interface MarketplaceResponse {
  query: string
  agents: MarketplaceAgent[]
  total: number
  num_hits: number
  error: string | null
}

export interface RegisteredAgent {
  id: string
  intent: string
  name: string
  type: string
  domain: string
  description: string
  address: string
  status: string
  avatar: string
  interactions: number
  marketplace_url: string
}

export interface AgentsResponse {
  agents: RegisteredAgent[]
  count: number
}

export type IntentStatus =
  | 'captured'
  | 'classifying'
  | 'routing'
  | 'awaiting'
  | 'ok'
  | 'unknown_intent'
  | 'timeout'
  | 'error'

export interface IntentRecord {
  session_id: string
  seq: number
  query: string
  origin: 'rest' | 'chat'
  intent: string
  status: IntentStatus
  downstream: string
  product_count: number
  message: string
}

export interface IntentStats {
  total: number
  ok: number
  awaiting: number
  routing: number
  failed: number
}

export interface IntentsResponse {
  intents: IntentRecord[]
  stats: IntentStats
}

export interface Health {
  status: string
  agent_address: string
}

export interface DeflectionPolicy {
  always_gate: boolean
  auto_max_amount: number
  summary: string
}

export interface SpaceAgent {
  address: string
  name: string
  domain: string
  category: string
  avatar: string
  capabilities: string[]
  added_at: string
  policy: DeflectionPolicy
  sample_decision: 'GATE' | 'AUTO'
  sample_reason: string
}

export interface SpaceResponse {
  agents: SpaceAgent[]
  count: number
}

export interface RegisterResponse {
  ok: boolean
  message: string
  agent: SpaceAgent | null
}

export interface ResolveResponse {
  address: string
  found: boolean
  status: string
  type: string
  endpoint: string
  protocols: string[]
  protocol_count: number
  speaks_chat: boolean
  error: string | null
}

export interface SpaceChatResponse {
  ok: boolean
  address: string
  agent_name: string
  reply: string
  message: string
  deflected: boolean
}
