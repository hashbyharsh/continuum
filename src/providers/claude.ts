import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, resolve, delimiter as pathDelimiter } from 'node:path'
import { homedir } from 'node:os'
import { calculateCost } from '../models.js'
import type { Provider, SessionSource, RawProviderCall } from './types.js'

// ── Config dir resolution ─────────────────────────────────────────────────────

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

function getClaudeConfigDirs(): string[] {
  const multi = process.env['CLAUDE_CONFIG_DIRS']
  if (multi) {
    const dirs = multi.split(pathDelimiter).map(s => resolve(expandHome(s.trim()))).filter(Boolean)
    if (dirs.length) return [...new Set(dirs)]
  }
  const single = process.env['CLAUDE_CONFIG_DIR']
  if (single) return [resolve(expandHome(single))]
  return [join(homedir(), '.claude')]
}

function getDesktopSessionsDir(): string {
  const override = process.env['TOKEN_OPT_DESKTOP_SESSIONS_DIR']
  if (override) return override
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions')
  if (process.platform === 'win32')
    return join(homedir(), 'AppData', 'Roaming', 'Claude', 'local-agent-mode-sessions')
  return join(homedir(), '.config', 'Claude', 'local-agent-mode-sessions')
}

async function findDesktopProjectDirs(base: string): Promise<string[]> {
  const results: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return
    const entries = await readdir(dir).catch(() => [])
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git') continue
      const full = join(dir, entry)
      const s = await stat(full).catch(() => null)
      if (!s?.isDirectory()) continue
      if (entry === 'projects') {
        const pds = await readdir(full).catch(() => [])
        for (const pd of pds) {
          const pdFull = join(full, pd)
          if ((await stat(pdFull).catch(() => null))?.isDirectory()) results.push(pdFull)
        }
      } else {
        await walk(full, depth + 1)
      }
    }
  }
  await walk(base, 0)
  return results
}

// ── JSONL parsing ─────────────────────────────────────────────────────────────

interface ApiUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  server_tool_use?: { web_search_requests?: number }
}

interface JournalEntry {
  type?: string
  uuid?: string
  timestamp?: string
  sessionId?: string
  message?: {
    role?: string
    model?: string
    usage?: ApiUsage
    content?: Array<{ type: string; name?: string; text?: string }>
    stop_reason?: string
  }
  isSidechain?: boolean
  [k: string]: unknown
}

async function* readJsonlLines(filePath: string): AsyncGenerator<string> {
  const text = await readFile(filePath, 'utf-8').catch(() => '')
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (t) yield t
  }
}

async function* parseClaude(
  sessionFile: string,
  project: string,
  seenKeys: Set<string>,
): AsyncGenerator<RawProviderCall> {
  const turns: JournalEntry[] = []
  for await (const line of readJsonlLines(sessionFile)) {
    try { turns.push(JSON.parse(line) as JournalEntry) } catch { /* skip */ }
  }

  // Collect user messages so we can attach them to the following assistant turn
  const userMessages: Record<string, string> = {}
  for (const entry of turns) {
    if (entry.type === 'user' && entry.message?.role === 'user') {
      const content = entry.message.content
      if (Array.isArray(content)) {
        const text = content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
        if (entry.uuid) userMessages[entry.uuid] = text
      } else if (typeof content === 'string') {
        if (entry.uuid) userMessages[entry.uuid] = content
      }
    }
  }

  for (const entry of turns) {
    if (entry.isSidechain) continue
    if (entry.type !== 'assistant') continue
    const msg = entry.message
    if (!msg || msg.role !== 'assistant') continue
    const usage = msg.usage
    if (!usage) continue

    const model = msg.model ?? 'unknown'
    const inputTokens = usage.input_tokens ?? 0
    const outputTokens = usage.output_tokens ?? 0
    const cacheCreation = usage.cache_creation_input_tokens ?? 0
    const cacheRead = usage.cache_read_input_tokens ?? 0
    const webSearch = usage.server_tool_use?.web_search_requests ?? 0
    const timestamp = entry.timestamp ?? new Date().toISOString()
    const sessionId = entry.sessionId ?? basename(sessionFile, '.jsonl')

    const key = `claude:${sessionId}:${entry.uuid ?? timestamp}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    // Gather tools called in this assistant turn
    const tools: string[] = []
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.name) tools.push(block.name)
      }
    }

    // Find associated user message (the entry before this one with a parent UUID)
    const parentUuid = (entry as { parentUuid?: string }).parentUuid
    const userMessage = (parentUuid ? userMessages[parentUuid] : undefined) ?? ''

    yield {
      provider: 'claude',
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens: cacheCreation,
      cacheReadTokens: cacheRead,
      reasoningTokens: 0,
      webSearchRequests: webSearch,
      costUSD: calculateCost(model, inputTokens, outputTokens, cacheCreation, cacheRead),
      tools,
      timestamp,
      sessionId,
      userMessage,
      deduplicationKey: key,
    }
  }
}

// ── Provider definition ───────────────────────────────────────────────────────

export const claude: Provider = {
  name: 'claude',
  displayName: 'Claude Code',

  async discoverSessions(): Promise<SessionSource[]> {
    const sources: SessionSource[] = []
    const seen = new Set<string>()

    // Standard ~/.claude/projects/
    for (const claudeDir of getClaudeConfigDirs()) {
      const projectsDir = join(claudeDir, 'projects')
      const entries = await readdir(projectsDir).catch(() => [])
      for (const dirName of entries) {
        const dirPath = join(projectsDir, dirName)
        const res = resolve(dirPath)
        if (seen.has(res)) continue
        if (!(await stat(dirPath).catch(() => null))?.isDirectory()) continue
        seen.add(res)
        sources.push({ path: dirPath, project: dirName.replace(/-/g, '/'), provider: 'claude' })
      }
    }

    // Claude Desktop / Cowork sessions
    const desktopDirs = await findDesktopProjectDirs(getDesktopSessionsDir())
    for (const dirPath of desktopDirs) {
      const res = resolve(dirPath)
      if (seen.has(res)) continue
      seen.add(res)
      sources.push({ path: dirPath, project: basename(dirPath), provider: 'claude' })
    }

    return sources
  },

  async *parseSession(source: SessionSource, seenKeys: Set<string>): AsyncGenerator<RawProviderCall> {
    const files = await readdir(source.path).catch(() => [])
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      yield* parseClaude(join(source.path, f), source.project, seenKeys)
    }
  },
}
