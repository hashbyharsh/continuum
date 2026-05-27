export type SessionSource = {
  path: string
  project: string
  provider: string
}

export type RawProviderCall = {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  webSearchRequests: number
  costUSD: number
  tools: string[]
  timestamp: string
  sessionId: string
  userMessage: string
  deduplicationKey: string
}

export type Provider = {
  name: string
  displayName: string
  discoverSessions(): Promise<SessionSource[]>
  parseSession(source: SessionSource, seenKeys: Set<string>): AsyncGenerator<RawProviderCall>
}
