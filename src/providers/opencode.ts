import { readdir, readFile, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { calculateCost } from '../models.js'
import type { Provider, SessionSource, RawProviderCall } from './types.js'

function getOpenCodeDir(): string {
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'opencode')
  if (process.platform === 'win32')
    return join(homedir(), 'AppData', 'Roaming', 'opencode')
  return join(homedir(), '.local', 'share', 'opencode')
}

interface OpenCodeEntry {
  id?: string
  time?: string
  metadata?: {
    model?: { id?: string }
    tokens?: {
      input?: number
      output?: number
      cache_read?: number
      cache_creation?: number
    }
    cost?: number
    tool?: { name?: string }
  }
  role?: string
  parts?: Array<{ type: string; text?: string }>
}

async function* parseOpenCodeSession(
  sessionDir: string,
  sessionId: string,
  seenKeys: Set<string>,
): AsyncGenerator<RawProviderCall> {
  const messagesFile = join(sessionDir, 'messages.json')
  const text = await readFile(messagesFile, 'utf-8').catch(() => '')
  if (!text) return

  let entries: OpenCodeEntry[]
  try { entries = JSON.parse(text) as OpenCodeEntry[] } catch { return }

  let lastUserMsg = ''
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.role === 'user') {
      lastUserMsg = (entry.parts ?? []).filter(p => p.type === 'text').map(p => p.text ?? '').join('\n')
      continue
    }
    if (entry.role !== 'assistant') continue
    const meta = entry.metadata
    if (!meta?.tokens) continue

    const model = meta.model?.id ?? 'unknown'
    const inputTokens = meta.tokens.input ?? 0
    const outputTokens = meta.tokens.output ?? 0
    const cacheRead = meta.tokens.cache_read ?? 0
    const cacheCreation = meta.tokens.cache_creation ?? 0
    const costUSD = meta.cost ?? calculateCost(model, inputTokens, outputTokens, cacheCreation, cacheRead)
    const timestamp = entry.time ?? new Date().toISOString()
    const key = `opencode:${sessionId}:${i}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    yield {
      provider: 'opencode',
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens: cacheRead,
      reasoningTokens: 0,
      webSearchRequests: 0,
      costUSD,
      tools: [],
      timestamp,
      sessionId,
      userMessage: lastUserMsg,
      deduplicationKey: key,
    }
  }
}

export const opencode: Provider = {
  name: 'opencode',
  displayName: 'OpenCode',

  async discoverSessions(): Promise<SessionSource[]> {
    const base = join(getOpenCodeDir(), 'session')
    const entries = await readdir(base).catch(() => [])
    const sources: SessionSource[] = []
    for (const entry of entries) {
      const full = join(base, entry)
      if ((await stat(full).catch(() => null))?.isDirectory()) {
        sources.push({ path: full, project: entry, provider: 'opencode' })
      }
    }
    return sources
  },

  async *parseSession(source: SessionSource, seenKeys: Set<string>): AsyncGenerator<RawProviderCall> {
    yield* parseOpenCodeSession(source.path, source.project, seenKeys)
  },
}
