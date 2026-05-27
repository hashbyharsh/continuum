import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { calculateCost } from '../models.js'
import type { Provider, SessionSource, RawProviderCall } from './types.js'

function getCodexDir(): string {
  return join(homedir(), '.codex')
}

interface CodexSession {
  id?: string
  model?: string
  created_at?: string
  items?: Array<{
    type?: string
    role?: string
    content?: string | Array<{ type: string; text?: string }>
    usage?: {
      input_tokens?: number
      output_tokens?: number
      reasoning_tokens?: number
    }
  }>
}

async function* parseCodexFile(
  filePath: string,
  seenKeys: Set<string>,
): AsyncGenerator<RawProviderCall> {
  const text = await readFile(filePath, 'utf-8').catch(() => '')
  let session: CodexSession
  try { session = JSON.parse(text) as CodexSession } catch { return }

  const model = session.model ?? 'codex-mini-latest'
  const sessionId = session.id ?? filePath
  const items = session.items ?? []
  let lastUserMsg = ''

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.role === 'user') {
      if (typeof item.content === 'string') lastUserMsg = item.content
      else if (Array.isArray(item.content)) {
        lastUserMsg = item.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
      }
      continue
    }
    if (item.role !== 'assistant') continue
    const usage = item.usage
    if (!usage) continue

    const inputTokens = usage.input_tokens ?? 0
    const outputTokens = usage.output_tokens ?? 0
    const reasoningTokens = usage.reasoning_tokens ?? 0
    const timestamp = session.created_at ?? new Date().toISOString()
    const key = `codex:${sessionId}:${i}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    yield {
      provider: 'codex',
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens,
      webSearchRequests: 0,
      costUSD: calculateCost(model, inputTokens, outputTokens),
      tools: [],
      timestamp,
      sessionId,
      userMessage: lastUserMsg,
      deduplicationKey: key,
    }
  }
}

export const codex: Provider = {
  name: 'codex',
  displayName: 'Codex CLI',

  async discoverSessions(): Promise<SessionSource[]> {
    const base = join(getCodexDir(), 'sessions')
    const entries = await readdir(base).catch(() => [])
    const sources: SessionSource[] = []
    for (const entry of entries) {
      const full = join(base, entry)
      if ((await stat(full).catch(() => null))?.isFile() && entry.endsWith('.json')) {
        sources.push({ path: full, project: entry.replace('.json', ''), provider: 'codex' })
      }
    }
    return sources
  },

  async *parseSession(source: SessionSource, seenKeys: Set<string>): AsyncGenerator<RawProviderCall> {
    yield* parseCodexFile(source.path, seenKeys)
  },
}
