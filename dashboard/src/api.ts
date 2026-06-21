import type {
  AgentsResponse,
  Health,
  IntentsResponse,
  MarketplaceAgent,
  MarketplaceResponse,
  RegisterResponse,
  ResolveResponse,
  SpaceChatResponse,
  SpaceResponse,
} from './types'

// All calls go through Vite's /api proxy -> orchestrator (:8000).
const BASE = '/api'

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export function getHealth(): Promise<Health> {
  return fetch(`${BASE}/health`).then(json<Health>)
}

export function getAgents(): Promise<AgentsResponse> {
  return fetch(`${BASE}/agents`).then(json<AgentsResponse>)
}

export function getIntents(): Promise<IntentsResponse> {
  return fetch(`${BASE}/intents`).then(json<IntentsResponse>)
}

export function clearIntents(): Promise<{ ok: boolean; cleared: number }> {
  return fetch(`${BASE}/intents/clear`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }).then(json<{ ok: boolean; cleared: number }>)
}

export function searchMarketplace(
  search_text: string,
  limit = 12,
): Promise<MarketplaceResponse> {
  return fetch(`${BASE}/marketplace/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ search_text, limit }),
  }).then(json<MarketplaceResponse>)
}

export interface ClassifyResponse {
  session_id: string
  intent: string
  status: string
  message: string
  products: { title: string; url: string; price?: string }[] | null
}

export function classify(query: string): Promise<ClassifyResponse> {
  return fetch(`${BASE}/classify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  }).then(json<ClassifyResponse>)
}

export function getSpace(): Promise<SpaceResponse> {
  return fetch(`${BASE}/space`).then(json<SpaceResponse>)
}

export function registerAgent(a: MarketplaceAgent): Promise<RegisterResponse> {
  return fetch(`${BASE}/agents/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      address: a.address,
      name: a.name,
      domain: a.domain || a.category || '',
      category: a.category,
      avatar: a.avatar,
      capabilities: a.tags,
    }),
  }).then(json<RegisterResponse>)
}

export function removeAgent(address: string): Promise<RegisterResponse> {
  return fetch(`${BASE}/agents/remove`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  }).then(json<RegisterResponse>)
}

export function resolveAgent(address: string): Promise<ResolveResponse> {
  return fetch(`${BASE}/agents/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  }).then(json<ResolveResponse>)
}

export function spaceChat(address: string, message: string): Promise<SpaceChatResponse> {
  return fetch(`${BASE}/space/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, message }),
  }).then(json<SpaceChatResponse>)
}
