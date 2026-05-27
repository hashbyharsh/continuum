/**
 * Generic JSONL-based provider helper.
 * Used by Cline, Roo Code, Kilo Code, and similar tools that store sessions
 * as JSONL files with Anthropic-compatible usage objects.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { calculateCost } from '../models.js'
import type { RawProviderCall } from './types.js'

interface GenericUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

interface GenericEntry {
  type?: string
  role?: string
  model?: string
  usage?: GenericUsage
  timestamp?: string
  sessionId?: string
  id?: string
  content?: Array<{ type: string; name?: string }>
  [k: string]: unknown
}

export async function* parseGenericJsonl(
  filePath: string,
  providerName: string,
  project: string,
  seenKeys: Set<string>,
  defaultModel = 'unknown',
): AsyncGenerator<RawProviderCall> {
  const text = await readFile(filePath, 'utf-8').catch(() => '')
  const lines = text.split('\n').filter(l => l.trim())
  const userMessages: string[] = []

  for (const line of lines) {
    let entry: GenericEntry
    try { entry = JSON.parse(line) as GenericEntry } catch { continue }

    // Collect user messages
    if (entry.role === 'user' || entry.type === 'user') {
      const content = (entry as { content?: unknown }).content
      if (typeof content === 'string') userMessages.push(content)
      else if (Array.isArray(content)) {
        userMessages.push(
          (content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === 'text')
            .map(b => b.text ?? '')
            .join('\n'),
        )
      }
      continue
    }

    if (entry.role !== 'assistant' && entry.type !== 'assistant') continue
    const usage = entry.usage
    if (!usage) continue

    const model = entry.model ?? defaultModel
    const inputTokens = usage.input_tokens ?? 0
    const outputTokens = usage.output_tokens ?? 0
    const cacheCreation = usage.cache_creation_input_tokens ?? 0
    const cacheRead = usage.cache_read_input_tokens ?? 0
    const timestamp = (typeof entry.timestamp === 'string' ? entry.timestamp : null) ?? new Date().toISOString()
    const sessionId = (typeof entry.sessionId === 'string' ? entry.sessionId : null)
      ?? (typeof entry.id === 'string' ? entry.id : null)
      ?? filePath

    const key = `${providerName}:${sessionId}:${timestamp}:${inputTokens}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    const tools: string[] = []
    if (Array.isArray(entry.content)) {
      for (const block of entry.content) {
        if (block.type === 'tool_use' && (block as { name?: string }).name) {
          tools.push((block as { name: string }).name)
        }
      }
    }

    yield {
      provider: providerName,
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens: cacheRead,
      reasoningTokens: 0,
      webSearchRequests: 0,
      costUSD: calculateCost(model, inputTokens, outputTokens, cacheCreation, cacheRead),
      tools,
      timestamp,
      sessionId,
      userMessage: userMessages[userMessages.length - 1] ?? '',
      deduplicationKey: key,
    }
  }
}

export async function* parseGenericSessionDir(
  sessionDir: string,
  providerName: string,
  project: string,
  seenKeys: Set<string>,
  defaultModel = 'unknown',
): AsyncGenerator<RawProviderCall> {
  const files = await readdir(sessionDir).catch(() => [])
  for (const f of files) {
    if (!f.endsWith('.jsonl') && !f.endsWith('.json')) continue
    const filePath = join(sessionDir, f)
    const s = await stat(filePath).catch(() => null)
    if (!s?.isFile()) continue
    yield* parseGenericJsonl(filePath, providerName, project, seenKeys, defaultModel)
  }
}
