import { readdir, readFile, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { calculateCost } from '../models.js'
import type { Provider, SessionSource, RawProviderCall } from './types.js'

function getCopilotLogDir(): string {
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'Code', 'logs')
  if (process.platform === 'win32')
    return join(homedir(), 'AppData', 'Roaming', 'Code', 'logs')
  return join(homedir(), '.config', 'Code', 'logs')
}

interface CopilotLogEntry {
  model?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
  timestamp?: string
  request_id?: string
  prompt?: string
}

async function* parseCopilotLog(
  filePath: string,
  sessionId: string,
  seenKeys: Set<string>,
): AsyncGenerator<RawProviderCall> {
  const text = await readFile(filePath, 'utf-8').catch(() => '')
  let idx = 0
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    // Copilot logs are not always JSONL — skip non-JSON lines
    if (!t.startsWith('{')) continue
    let entry: CopilotLogEntry
    try { entry = JSON.parse(t) as CopilotLogEntry } catch { continue }
    const usage = entry.usage
    if (!usage?.prompt_tokens && !usage?.completion_tokens) continue

    const model = entry.model ?? 'gpt-4o'
    const inputTokens = usage.prompt_tokens ?? 0
    const outputTokens = usage.completion_tokens ?? 0
    const timestamp = entry.timestamp ?? new Date().toISOString()
    const key = `copilot:${sessionId}:${entry.request_id ?? idx++}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    yield {
      provider: 'copilot',
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
      userMessage: entry.prompt ?? '',
      deduplicationKey: key,
    }
  }
}

export const copilot: Provider = {
  name: 'copilot',
  displayName: 'GitHub Copilot',

  async discoverSessions(): Promise<SessionSource[]> {
    const base = getCopilotLogDir()
    const entries = await readdir(base).catch(() => [])
    const sources: SessionSource[] = []
    for (const entry of entries) {
      const full = join(base, entry)
      if ((await stat(full).catch(() => null))?.isDirectory()) {
        // Look for copilot-specific log files inside dated subdirs
        const files = await readdir(full).catch(() => [])
        for (const f of files) {
          if (f.toLowerCase().includes('copilot') && f.endsWith('.log')) {
            sources.push({ path: join(full, f), project: entry, provider: 'copilot' })
          }
        }
      }
    }
    return sources
  },

  async *parseSession(source: SessionSource, seenKeys: Set<string>): AsyncGenerator<RawProviderCall> {
    yield* parseCopilotLog(source.path, basename(source.path), seenKeys)
  },
}
