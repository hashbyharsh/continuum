// ── Token counts ──────────────────────────────────────────────────────────────

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
  webSearchRequests: number
}

export function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    webSearchRequests: 0,
  }
}

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    webSearchRequests: a.webSearchRequests + b.webSearchRequests,
  }
}

// ── Per-turn types ────────────────────────────────────────────────────────────

export type TaskCategory =
  | 'coding'
  | 'debugging'
  | 'feature'
  | 'refactoring'
  | 'testing'
  | 'exploration'
  | 'planning'
  | 'delegation'
  | 'git'
  | 'build/deploy'
  | 'conversation'
  | 'brainstorming'
  | 'general'

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  coding: 'Coding',
  debugging: 'Debugging',
  feature: 'Feature Dev',
  refactoring: 'Refactoring',
  testing: 'Testing',
  exploration: 'Exploration',
  planning: 'Planning',
  delegation: 'Delegation',
  git: 'Git Ops',
  'build/deploy': 'Build/Deploy',
  conversation: 'Conversation',
  brainstorming: 'Brainstorming',
  general: 'General',
}

export type ParsedTurn = {
  provider: string
  model: string
  usage: TokenUsage
  costUSD: number
  tools: string[]
  timestamp: string
  sessionId: string
  userMessage: string
  /** Estimated prompt token count from the user message text */
  promptTokenEstimate: number
  category: TaskCategory
}

// ── Session & Project summaries ───────────────────────────────────────────────

export type SessionSummary = {
  sessionId: string
  provider: string
  project: string
  /** Human-friendly display name, cleaned up from raw internal paths */
  displayName: string
  firstTimestamp: string
  lastTimestamp: string
  totalCostUSD: number
  totalUsage: TokenUsage
  apiCalls: number
  turns: ParsedTurn[]
  modelBreakdown: Record<string, { calls: number; costUSD: number; tokens: TokenUsage }>
  toolBreakdown: Record<string, { calls: number }>
  categoryBreakdown: Record<TaskCategory, { turns: number; costUSD: number }>
  /**
   * Context window utilization 0-1.
   * Uses the PEAK (max) input tokens in any single API call — not the sum
   * across all calls — because each call already includes the full history.
   */
  contextUtilization: number
  /** Peak input tokens seen in a single API call (true context window usage) */
  peakContextTokens: number
}

export type ProjectSummary = {
  project: string
  projectPath: string
  provider: string
  sessions: SessionSummary[]
  totalCostUSD: number
  totalApiCalls: number
  totalUsage: TokenUsage
}

export type DateRange = {
  start: Date
  end: Date
}

// ── Context Capsule ───────────────────────────────────────────────────────────

export type CapsuleAlert = {
  sessionId: string
  project: string
  provider: string
  model: string
  contextWindowSize: number
  totalContextTokens: number
  utilization: number   // 0-1
  severity: 'warning' | 'critical'  // >70% = warning, >90% = critical
}

export type ContextCapsule = {
  version: '1'
  generatedAt: string
  project: string
  provider: string
  model: string
  sessionId: string
  contextWindowSize: number
  tokensUsed: number
  utilizationPercent: number
  summary: string
  keyDecisions: string[]
  currentTask: string
  openQuestions: string[]
  recentTools: string[]
  continuationPrompt: string
}

// ── Prompt Recommendations ────────────────────────────────────────────────────

export type PromptIssue =
  | 'too_verbose'       // prompt is >400 tokens estimated
  | 'repeated_context'  // similar context sent multiple turns in a row
  | 'missing_cache_hint' // large context without cache directives
  | 'vague_task'        // prompt lacks specific actionable instructions
  | 'no_format_constraint' // no output format guidance, leading to long replies

export type PromptRecommendation = {
  issue: PromptIssue
  severity: 'info' | 'medium' | 'high'
  description: string
  originalSnippet?: string
  templateName: string
  templateDescription: string
  estimatedSavingPercent: number
  category: TaskCategory
}
