/**
 * Context Capsule — Detector
 *
 * Scans sessions for context-window pressure and returns CapsuleAlert objects
 * for sessions that are approaching or exceeding their model's context limit.
 */
import { getContextWindow } from '../models.js'
import type { SessionSummary } from '../types.js'
import type { CapsuleAlert } from '../types.js'

/** Token utilization thresholds */
export const THRESHOLD_WARNING  = 0.70  // 70%  → 'warning'
export const THRESHOLD_CRITICAL = 0.90  // 90%  → 'critical'

/**
 * Given a list of sessions, returns alerts for any that are near their
 * context window limit. Sessions below the warning threshold are skipped.
 */
export function detectAlerts(sessions: SessionSummary[]): CapsuleAlert[] {
  const alerts: CapsuleAlert[] = []

  for (const sess of sessions) {
    // Derive primary model from modelBreakdown (highest call count)
    const primaryModel = Object.entries(sess.modelBreakdown)
      .sort(([, a], [, b]) => b.calls - a.calls)[0]?.[0] ?? 'unknown'

    const contextWindow = getContextWindow(primaryModel)
    // Use peak (max single-call) tokens — not the sum across all turns
    const peakCtx = sess.peakContextTokens
    const utilization = peakCtx / contextWindow

    if (utilization < THRESHOLD_WARNING) continue

    alerts.push({
      sessionId: sess.sessionId,
      project: sess.displayName,
      provider: sess.provider,
      model: primaryModel,
      contextWindowSize: contextWindow,
      totalContextTokens: peakCtx,
      utilization,
      severity: utilization >= THRESHOLD_CRITICAL ? 'critical' : 'warning',
    })
  }

  return alerts.sort((a, b) => b.utilization - a.utilization)
}

/**
 * Returns true if the session has exhausted its context window
 * (utilization >= 100%).
 */
export function isContextExhausted(session: SessionSummary): boolean {
  return session.contextUtilization >= 1
}

/**
 * Returns how many tokens remain before the context window is full.
 */
export function tokensRemaining(session: SessionSummary): number {
  const primaryModel = Object.entries(session.modelBreakdown)
    .sort(([, a], [, b]) => b.calls - a.calls)[0]?.[0] ?? 'unknown'
  const contextWindow = getContextWindow(primaryModel)
  return Math.max(0, contextWindow - session.peakContextTokens)
}
