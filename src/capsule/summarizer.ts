/**
 * Context Capsule — Summarizer
 *
 * Compresses a session's conversation history into a structured ContextCapsule.
 * No external AI call is made — this is a deterministic, heuristic summarization
 * that extracts key signals from the parsed turns.
 */
import type { SessionSummary, ParsedTurn, ContextCapsule, TaskCategory } from '../types.js'
import { getContextWindow, getShortModelName } from '../models.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, max = 120): string {
  s = s.replace(/\s+/g, ' ').trim()
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Key decision extraction ────────────────────────────────────────────────────
// Heuristic: look for turns with explicit decision keywords in the user message.
const DECISION_RE = /\b(decided?|chose?|going with|will use|settled on|agreed|pick(ed)?|use\s+\w+|switch(ed)? to)\b/i
const QUESTION_RE = /\b(should|could|would|is it|are there|how do|what is|which|can we|do we|need to)\b.*\?/i

function extractKeyDecisions(turns: ParsedTurn[]): string[] {
  const decisions: string[] = []
  for (const turn of turns) {
    const msg = turn.userMessage
    if (!msg || msg.length < 20) continue
    if (DECISION_RE.test(msg)) decisions.push(truncate(msg, 100))
  }
  // De-duplicate and take the last 8
  return [...new Set(decisions)].slice(-8)
}

function extractOpenQuestions(turns: ParsedTurn[]): string[] {
  const questions: string[] = []
  // Check the most recent 10 turns for unanswered questions
  const recent = turns.slice(-10)
  for (const turn of recent) {
    const msg = turn.userMessage
    if (!msg) continue
    const sentences = msg.split(/[.!]\s+/)
    for (const s of sentences) {
      if (QUESTION_RE.test(s) && s.length > 20) {
        questions.push(truncate(s.trim() + (s.endsWith('?') ? '' : '?'), 100))
      }
    }
  }
  return [...new Set(questions)].slice(0, 5)
}

// ── Current task inference ────────────────────────────────────────────────────

function inferCurrentTask(turns: ParsedTurn[]): string {
  // Take the most recent user message with substance
  for (let i = turns.length - 1; i >= 0; i--) {
    const msg = turns[i]!.userMessage
    if (msg && msg.length > 20) return truncate(msg, 150)
  }
  return 'Continuing work on project'
}

// ── Tool usage summary ────────────────────────────────────────────────────────

function recentTools(turns: ParsedTurn[], n = 10): string[] {
  const tools = new Set<string>()
  for (const turn of turns.slice(-n)) {
    for (const t of turn.tools) tools.add(t)
  }
  return [...tools].slice(0, 10)
}

// ── Category summary ──────────────────────────────────────────────────────────

function dominantCategory(turns: ParsedTurn[]): TaskCategory {
  const counts = new Map<TaskCategory, number>()
  for (const t of turns) {
    counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
  }
  let best: TaskCategory = 'general'
  let bestCount = 0
  for (const [cat, count] of counts) {
    if (count > bestCount) { best = cat; bestCount = count }
  }
  return best
}

// ── Session narrative ─────────────────────────────────────────────────────────

function buildSummary(session: SessionSummary, model: string): string {
  const turns = session.turns
  const numTurns = turns.length
  const cat = dominantCategory(turns)
  const costStr = session.totalCostUSD.toFixed(4)
  const totalIn = session.totalUsage.inputTokens.toLocaleString()
  const utilPct = Math.round(session.contextUtilization * 100)

  return (
    `Session "${session.project}" with ${getShortModelName(model)} — ` +
    `${numTurns} turn${numTurns !== 1 ? 's' : ''} of primarily ${cat} work. ` +
    `Used ${totalIn} input tokens (${utilPct}% of context window), ` +
    `costing $${costStr} USD.`
  )
}

// ── Continuation prompt ───────────────────────────────────────────────────────

function buildContinuationPrompt(capsule: Omit<ContextCapsule, 'continuationPrompt'>): string {
  const decisions = capsule.keyDecisions.length > 0
    ? `\n\nKey decisions made:\n${capsule.keyDecisions.map(d => `- ${d}`).join('\n')}`
    : ''

  const questions = capsule.openQuestions.length > 0
    ? `\n\nOpen questions still to resolve:\n${capsule.openQuestions.map(q => `- ${q}`).join('\n')}`
    : ''

  const tools = capsule.recentTools.length > 0
    ? `\n\nRecently used tools: ${capsule.recentTools.join(', ')}`
    : ''

  return (
    `# Context Capsule — Continue Session\n\n` +
    `**Previous model:** ${getShortModelName(capsule.model)}\n` +
    `**Project:** ${capsule.project}\n` +
    `**Context used:** ${capsule.utilizationPercent}% (${capsule.tokensUsed.toLocaleString()} / ${capsule.contextWindowSize.toLocaleString()} tokens)\n\n` +
    `## Session Summary\n${capsule.summary}` +
    decisions +
    questions +
    tools +
    `\n\n## Current Task\n${capsule.currentTask}\n\n` +
    `## Instructions\nPlease continue from where we left off. ` +
    `The previous session ran out of context. ` +
    `Pick up the current task above and proceed.`
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

export function summarizeSession(session: SessionSummary): ContextCapsule {
  const primaryModel = Object.entries(session.modelBreakdown)
    .sort(([, a], [, b]) => b.calls - a.calls)[0]?.[0] ?? 'unknown'

  const contextWindowSize = getContextWindow(primaryModel)
  const tokensUsed = session.totalUsage.inputTokens + session.totalUsage.cacheReadInputTokens
  const utilizationPercent = Math.round((tokensUsed / contextWindowSize) * 100)

  const base: Omit<ContextCapsule, 'continuationPrompt'> = {
    version: '1',
    generatedAt: new Date().toISOString(),
    project: session.project,
    provider: session.provider,
    model: primaryModel,
    sessionId: session.sessionId,
    contextWindowSize,
    tokensUsed,
    utilizationPercent,
    summary: buildSummary(session, primaryModel),
    keyDecisions: extractKeyDecisions(session.turns),
    currentTask: inferCurrentTask(session.turns),
    openQuestions: extractOpenQuestions(session.turns),
    recentTools: recentTools(session.turns),
  }

  return { ...base, continuationPrompt: buildContinuationPrompt(base) }
}
