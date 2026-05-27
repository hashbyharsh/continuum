/**
 * Prompt Recommendations — Analyzer
 *
 * Scans parsed turns for prompt anti-patterns and returns ranked
 * PromptRecommendation objects.
 */
import { estimateTokens } from '../models.js'
import type { ParsedTurn, PromptRecommendation, PromptIssue, TaskCategory } from '../types.js'
import { getTemplatesForCategory, TEMPLATES } from './templates.js'

// ── Thresholds ─────────────────────────────────────────────────────────────────

const VERBOSE_THRESHOLD   = 400   // estimated prompt tokens → too_verbose
const REPEAT_SIMILARITY   = 0.65  // Jaccard similarity for repeated_context
const CACHE_HINT_THRESHOLD = 200  // input tokens above which cache hints matter

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Crude Jaccard similarity on word sets */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let inter = 0
  for (const w of wordsA) if (wordsB.has(w)) inter++
  const union = wordsA.size + wordsB.size - inter
  return inter / union
}

/** Check if the prompt has explicit output-format constraints */
function hasFormatConstraint(msg: string): boolean {
  return /\b(json|markdown|bullet|numbered list|table|format:|output:|return only|≤\d+|max \d+|in \d+ words|no explanation|no prose)\b/i.test(msg)
}

/** Check if prompt contains cache directive hints */
function hasCacheHint(msg: string): boolean {
  return /\b(remember this|cache|system prompt|reuse|above context)\b/i.test(msg)
}

/** Public: classify a single prompt text into a category */
export function classifyPrompt(msg: string): TaskCategory {
  // Reuse the patterns from parser.ts (duplicated here to avoid circular dep)
  const patterns: Array<[TaskCategory, RegExp]> = [
    ['debugging',   /\b(bug|error|fix|debug|crash|fail|exception|traceback)\b/i],
    ['testing',     /\b(test|spec|jest|vitest|pytest|assert|coverage)\b/i],
    ['refactoring', /\b(refactor|rename|extract|move|restructure|clean up)\b/i],
    ['feature',     /\b(implement|add|create|build|new feature|feat)\b/i],
    ['git',         /\b(commit|push|pull|merge|branch|rebase|git)\b/i],
    ['build/deploy',/\b(build|deploy|ci|cd|pipeline|docker|release)\b/i],
    ['planning',    /\b(plan|design|architect|roadmap|spec|requirements)\b/i],
    ['brainstorming',/\b(brainstorm|ideas|options|alternatives)\b/i],
    ['exploration', /\b(explore|understand|explain|how does|what is|analyze)\b/i],
    ['conversation',/\b(hello|hi|thanks|thank you|great|sounds good)\b/i],
    ['coding',      /\b(code|function|class|method|module|file|implement)\b/i],
  ]
  for (const [cat, re] of patterns) if (re.test(msg)) return cat
  return 'general'
}

// ── Issue detectors ───────────────────────────────────────────────────────────

function detectVerbose(turn: ParsedTurn): PromptIssue | null {
  return turn.promptTokenEstimate > VERBOSE_THRESHOLD ? 'too_verbose' : null
}

function detectRepeatedContext(turn: ParsedTurn, previous: ParsedTurn[]): PromptIssue | null {
  const recent = previous.slice(-5)
  for (const prev of recent) {
    if (
      prev.userMessage &&
      turn.userMessage &&
      jaccardSimilarity(prev.userMessage, turn.userMessage) > REPEAT_SIMILARITY
    ) {
      return 'repeated_context'
    }
  }
  return null
}

function detectMissingCacheHint(turn: ParsedTurn): PromptIssue | null {
  if (turn.usage.inputTokens > CACHE_HINT_THRESHOLD && !hasCacheHint(turn.userMessage))
    return 'missing_cache_hint'
  return null
}

function detectVagueTask(turn: ParsedTurn): PromptIssue | null {
  const msg = turn.userMessage
  if (!msg || msg.length < 10) return null
  // Vague if: short + imperative + no specific target
  const isShort = estimateTokens(msg) < 30
  const isImperative = /^(fix|change|update|make|do|add|edit|write|create)\b/i.test(msg.trim())
  const lacksTarget = !/\b(in|at|the|file|function|class|module|line|component)\b/i.test(msg)
  return (isShort && isImperative && lacksTarget) ? 'vague_task' : null
}

function detectNoFormatConstraint(turn: ParsedTurn): PromptIssue | null {
  const msg = turn.userMessage
  if (!msg) return null
  // Only flag long output-producing prompts
  const isLong = estimateTokens(msg) > 50
  const isOutputProducing = /\b(explain|write|create|implement|list|describe|generate|show|give)\b/i.test(msg)
  return (isLong && isOutputProducing && !hasFormatConstraint(msg)) ? 'no_format_constraint' : null
}

// ── Recommendation builder ────────────────────────────────────────────────────

const ISSUE_META: Record<PromptIssue, { severity: 'info' | 'medium' | 'high'; description: string; savingPct: number }> = {
  too_verbose:          { severity: 'high',   description: 'Prompt is very long — could be shortened with a targeted template.',           savingPct: 40 },
  repeated_context:     { severity: 'high',   description: 'Similar context sent multiple turns in a row — consider caching it.',          savingPct: 35 },
  missing_cache_hint:   { severity: 'medium', description: 'Large context sent without cache directives — add a cache hint to save cost.', savingPct: 25 },
  vague_task:           { severity: 'medium', description: 'Prompt is vague — model may ask for clarification, costing extra turns.',      savingPct: 20 },
  no_format_constraint: { severity: 'info',   description: 'No output format specified — model may produce unnecessarily long responses.',  savingPct: 15 },
}

function buildRecommendation(
  issue: PromptIssue,
  turn: ParsedTurn,
): PromptRecommendation | null {
  const meta = ISSUE_META[issue]
  const catTemplates = getTemplatesForCategory(turn.category)
  const template = catTemplates.find(t => t.fixes.includes(issue))
    ?? TEMPLATES.find(t => t.fixes.includes(issue))
  if (!template) return null

  return {
    issue,
    severity: meta.severity,
    description: meta.description,
    originalSnippet: turn.userMessage.slice(0, 120),
    templateName: template.name,
    templateDescription: template.description,
    estimatedSavingPercent: meta.savingPct,
    category: turn.category,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export type TurnRecommendations = {
  turn: ParsedTurn
  recommendations: PromptRecommendation[]
}

/**
 * Analyze a list of turns and return per-turn recommendations.
 * Only turns that have at least one issue are returned.
 */
export function analyzeTurns(turns: ParsedTurn[]): TurnRecommendations[] {
  const results: TurnRecommendations[] = []

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!
    if (!turn.userMessage) continue

    const previous = turns.slice(0, i)
    const issues: PromptIssue[] = [
      detectVerbose(turn),
      detectRepeatedContext(turn, previous),
      detectMissingCacheHint(turn),
      detectVagueTask(turn),
      detectNoFormatConstraint(turn),
    ].filter((x): x is PromptIssue => x !== null)

    if (issues.length === 0) continue

    const recommendations = issues
      .map(issue => buildRecommendation(issue, turn))
      .filter((r): r is PromptRecommendation => r !== null)

    if (recommendations.length > 0) {
      results.push({ turn, recommendations })
    }
  }

  return results
}

/**
 * Return the top-N most impactful recommendations across all turns,
 * deduplicated by issue+template combination.
 */
export function topRecommendations(
  turns: ParsedTurn[],
  limit = 10,
): PromptRecommendation[] {
  const allRecs = analyzeTurns(turns).flatMap(r => r.recommendations)
  const seen = new Set<string>()
  const unique: PromptRecommendation[] = []
  for (const rec of allRecs) {
    const k = `${rec.issue}::${rec.templateName}`
    if (!seen.has(k)) {
      seen.add(k)
      unique.push(rec)
    }
  }
  // Sort: high → medium → info, then by saving %
  const sev = { high: 2, medium: 1, info: 0 } as const
  return unique
    .sort((a, b) =>
      sev[b.severity] - sev[a.severity] ||
      b.estimatedSavingPercent - a.estimatedSavingPercent,
    )
    .slice(0, limit)
}
