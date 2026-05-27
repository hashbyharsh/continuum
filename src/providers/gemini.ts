import { readdir, readFile, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { calculateCost } from '../models.js'
import type { Provider, SessionSource, RawProviderCall } from './types.js'

function getGeminiDir(): string {
  return join(homedir(), '.gemini')
}

interface GeminiLogEntry {
  timestamp?: string
  model?: string
  request?: {
    contents?: Array<{ role: string; parts: Array<{ text?: string }> }>
  }
  response?: {
    candidates?: Array<{ content?: { parts: Array<{ text?: string }> } }>
    usageMetadata?: {
      promptTokenCount?: number
      candidatesTokenCount?: number
      totalTokenCount?: number
    }
  }
}

async function* parseGeminiFile(
  filePath: string,
  sessionId: string,
  seenKeys: Set<string>,
): AsyncGenerator<RawProviderCall> {
  const text = await readFile(filePath, 'utf-8').catch(() => '')
  const lines = text.split('\n').filter(l => l.trim())
  let idx = 0
  for (const line of lines) {
    let entry: GeminiLogEntry
    try { entry = JSON.parse(line) as GeminiLogEntry } catch { continue }

    const usage = entry.response?.usageMetadata
    if (!usage) continue

    const model = entry.model ?? 'gemini-2.5-flash'
    const inputTokens = usage.promptTokenCount ?? 0
    const outputTokens = usage.candidatesTokenCount ?? 0
    const timestamp = entry.timestamp ?? new Date().toISOString()
    const key = `gemini:${sessionId}:${idx++}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    const contents = entry.request?.contents ?? []
    const userMessages = contents
      .filter(c => c.role === 'user')
      .map(c => c.parts.map(p => p.text ?? '').join(''))
    const lastUserMsg = userMessages[userMessages.length - 1] ?? ''

    yield {
      provider: 'gemini',
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
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

export const gemini: Provider = {
  name: 'gemini',
  displayName: 'Gemini CLI',

  async discoverSessions(): Promise<SessionSource[]> {
    const logsDir = join(getGeminiDir(), 'logs')
    const entries = await readdir(logsDir).catch(() => [])
    const sources: SessionSource[] = []
    for (const entry of entries) {
      const full = join(logsDir, entry)
      if ((await stat(full).catch(() => null))?.isFile() && entry.endsWith('.jsonl')) {
        sources.push({ path: full, project: basename(entry, '.jsonl'), provider: 'gemini' })
      }
    }
    return sources
  },

  async *parseSession(source: SessionSource, seenKeys: Set<string>): AsyncGenerator<RawProviderCall> {
    yield* parseGeminiFile(source.path, source.project, seenKeys)
  },
}
