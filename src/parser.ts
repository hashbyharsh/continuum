import { discoverAllSessions, getProvider, ALL_PROVIDERS } from './providers/index.js'
import { getContextWindow, estimateTokens } from './models.js'
import { classifyPrompt } from './recommendations/analyzer.js'
import {
  type TokenUsage,
  type ParsedTurn,
  type SessionSummary,
  type ProjectSummary,
  type DateRange,
  type TaskCategory,
  emptyTokenUsage,
  addTokenUsage,
  CATEGORY_LABELS,
} from './types.js'

// ── Token usage helpers ───────────────────────────────────────────────────────

function rawToTokenUsage(raw: {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  webSearchRequests: number
}): TokenUsage {
  return {
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    cacheCreationInputTokens: raw.cacheCreationTokens,
    cacheReadInputTokens: raw.cacheReadTokens,
    cachedInputTokens: raw.cacheReadTokens,
    reasoningTokens: raw.reasoningTokens,
    webSearchRequests: raw.webSearchRequests,
  }
}

// ── Date filtering ────────────────────────────────────────────────────────────

function inRange(timestamp: string, range?: DateRange): boolean {
  if (!range) return true
  const d = new Date(timestamp)
  return d >= range.start && d <= range.end
}

// ── Classifier (lightweight keyword-based) ────────────────────────────────────

const CATEGORY_PATTERNS: Array<[TaskCategory, RegExp]> = [
  ['debugging',   /\b(bug|error|fix|debug|crash|fail|exception|traceback|undefined|null ref)\b/i],
  ['testing',     /\b(test|spec|jest|vitest|pytest|assert|coverage|unit test|integration test)\b/i],
  ['refactoring', /\b(refactor|rename|extract|move|restructure|clean up|reorganize)\b/i],
  ['feature',     /\b(implement|add|create|build|new feature|feat|support for)\b/i],
  ['git',         /\b(commit|push|pull|merge|branch|rebase|git|pr|pull request|diff|stash)\b/i],
  ['build/deploy',/\b(build|deploy|ci|cd|pipeline|docker|kubernetes|k8s|release|publish|npm|yarn)\b/i],
  ['planning',    /\b(plan|design|architect|roadmap|spec|requirements|estimate|how should|what should)\b/i],
  ['delegation',  /\b(subagent|spawn agent|delegate|parallel task|sub-task)\b/i],
  ['brainstorming',/\b(brainstorm|ideas|options|alternatives|suggestions|what if|could we)\b/i],
  ['exploration', /\b(explore|understand|explain|how does|what is|analyze|investigate|look at)\b/i],
  ['conversation',/\b(hello|hi|thanks|thank you|great|sounds good|looks good|ok|okay)\b/i],
  ['coding',      /\b(code|function|class|method|module|file|variable|type|interface|implement)\b/i],
]

function classifyCategory(userMessage: string): TaskCategory {
  if (!userMessage) return 'general'
  for (const [cat, re] of CATEGORY_PATTERNS) {
    if (re.test(userMessage)) return cat
  }
  return 'general'
}

// ── Project name cleanup ──────────────────────────────────────────────────────

/**
 * Converts ugly internal Cowork paths like:
 *   -Users-delente-Library-Application-Support-Claude-local-agent-mode-sessions-...-outputs
 * into something readable like:
 *   Cowork · 7c134c7e
 *
 * For normal project paths (e.g. -Users-delente-dev-myapp) extracts the
 * last meaningful segment (e.g. "myapp").
 */
function friendlyProjectName(raw: string): string {
  // Detect Cowork/Desktop session paths — they contain "local-agent-mode-sessions"
  if (raw.includes('local-agent-mode-sessions') || raw.includes('local-agent-mode')) {
    // Extract the local_<uuid> segment
    const match = raw.match(/local-([a-f0-9]{8})[a-f0-9-]+-outputs?$/i)
    if (match?.[1]) return `Cowork · ${match[1]}`
    // Fallback: grab last UUID-like segment
    const parts = raw.split('-').filter(p => p.length === 8 && /^[a-f0-9]+$/i.test(p))
    if (parts.length > 0) return `Cowork · ${parts[parts.length - 1]}`
    return 'Cowork Session'
  }

  // Regular project: the raw name is a sanitized path (slashes → hyphens).
  // Split on hyphens and take the last non-empty meaningful segment.
  const segments = raw.replace(/^[-/]/, '').split('-').filter(s => s.length > 2)
  const last = segments[segments.length - 1]
  if (last && last.length > 2) return last

  return raw.slice(0, 40)
}

// ── Session & Project building ────────────────────────────────────────────────

function emptySession(
  sessionId: string,
  provider: string,
  project: string,
): SessionSummary {
  const catBreakdown = {} as Record<TaskCategory, { turns: number; costUSD: number }>
  for (const cat of Object.keys(CATEGORY_LABELS) as TaskCategory[]) {
    catBreakdown[cat] = { turns: 0, costUSD: 0 }
  }
  return {
    sessionId,
    provider,
    project,
    displayName: friendlyProjectName(project),
    firstTimestamp: '',
    lastTimestamp: '',
    totalCostUSD: 0,
    totalUsage: emptyTokenUsage(),
    apiCalls: 0,
    turns: [],
    modelBreakdown: {},
    toolBreakdown: {},
    categoryBreakdown: catBreakdown,
    contextUtilization: 0,
    peakContextTokens: 0,
  }
}

function finalizeSession(session: SessionSummary): void {
  const primaryModel = Object.entries(session.modelBreakdown)
    .sort(([, a], [, b]) => b.calls - a.calls)[0]?.[0] ?? 'unknown'
  const contextWindow = getContextWindow(primaryModel)

  // Use the PEAK (max) input tokens seen in any single API call.
  // Summing across all turns is wrong because each call already includes
  // the full conversation history — you'd be multiplying context N times.
  const peak = session.turns.reduce((max, t) =>
    Math.max(max, t.usage.inputTokens + t.usage.cacheReadInputTokens), 0)

  session.peakContextTokens = peak
  session.contextUtilization = Math.min(peak / contextWindow, 1)
}

// ── Main parse functions ──────────────────────────────────────────────────────

export async function parseAllSessions(
  dateRange?: DateRange,
  providerFilter?: string,
): Promise<ProjectSummary[]> {
  const sources = await discoverAllSessions(providerFilter)
  const seenKeys = new Set<string>()
  const projectMap = new Map<string, ProjectSummary>()

  for (const source of sources) {
    const provider = getProvider(source.provider) ??
      ALL_PROVIDERS.find(p => p.name === source.provider)
    if (!provider) continue

    const projectKey = `${source.provider}::${source.project}`
    if (!projectMap.has(projectKey)) {
      projectMap.set(projectKey, {
        project: source.project,
        projectPath: source.path,
        provider: source.provider,
        sessions: [],
        totalCostUSD: 0,
        totalApiCalls: 0,
        totalUsage: emptyTokenUsage(),
      })
    }
    const proj = projectMap.get(projectKey)!

    const sessionMap = new Map<string, SessionSummary>()

    try {
      for await (const raw of provider.parseSession(source, seenKeys)) {
        if (!inRange(raw.timestamp, dateRange)) continue

        if (!sessionMap.has(raw.sessionId)) {
          sessionMap.set(raw.sessionId, emptySession(raw.sessionId, raw.provider, source.project))
        }
        const sess = sessionMap.get(raw.sessionId)!

        const usage = rawToTokenUsage(raw)
        const category = classifyCategory(raw.userMessage)
        const promptEst = estimateTokens(raw.userMessage)

        const turn: ParsedTurn = {
          provider: raw.provider,
          model: raw.model,
          usage,
          costUSD: raw.costUSD,
          tools: raw.tools,
          timestamp: raw.timestamp,
          sessionId: raw.sessionId,
          userMessage: raw.userMessage,
          promptTokenEstimate: promptEst,
          category,
        }

        sess.turns.push(turn)
        sess.apiCalls++
        sess.totalCostUSD += raw.costUSD
        sess.totalUsage = addTokenUsage(sess.totalUsage, usage)

        if (!sess.firstTimestamp || raw.timestamp < sess.firstTimestamp)
          sess.firstTimestamp = raw.timestamp
        if (!sess.lastTimestamp || raw.timestamp > sess.lastTimestamp)
          sess.lastTimestamp = raw.timestamp

        // Model breakdown (use 'unknown' for empty model names)
        const modelKey = raw.model || 'unknown'
        if (!sess.modelBreakdown[modelKey]) {
          sess.modelBreakdown[modelKey] = { calls: 0, costUSD: 0, tokens: emptyTokenUsage() }
        }
        const mb = sess.modelBreakdown[modelKey]!
        mb.calls++
        mb.costUSD += raw.costUSD
        mb.tokens = addTokenUsage(mb.tokens, usage)

        // Tool breakdown
        for (const tool of raw.tools) {
          if (!sess.toolBreakdown[tool]) sess.toolBreakdown[tool] = { calls: 0 }
          sess.toolBreakdown[tool]!.calls++
        }

        // Category breakdown
        sess.categoryBreakdown[category].turns++
        sess.categoryBreakdown[category].costUSD += raw.costUSD
      }
    } catch {
      // Provider parse errors are non-fatal
    }

    for (const sess of sessionMap.values()) {
      finalizeSession(sess)
      proj.sessions.push(sess)
      proj.totalCostUSD += sess.totalCostUSD
      proj.totalApiCalls += sess.apiCalls
      proj.totalUsage = addTokenUsage(proj.totalUsage, sess.totalUsage)
    }
  }

  return [...projectMap.values()].filter(p => p.sessions.length > 0)
}

export async function parseProjectSessions(
  providerName: string,
  projectName: string,
  dateRange?: DateRange,
): Promise<SessionSummary[]> {
  const allProjects = await parseAllSessions(dateRange, providerName)
  const proj = allProjects.find(p => p.project === projectName)
  return proj?.sessions ?? []
}
