/**
 * Context Capsule — Public API
 *
 * High-level entry points used by the CLI and web dashboard.
 */
import { detectAlerts, tokensRemaining } from './detector.js'
import { summarizeSession } from './summarizer.js'
import { exportCapsule, exportCapsuleToCwd } from './exporter.js'
import type { SessionSummary, CapsuleAlert, ContextCapsule } from '../types.js'

export { detectAlerts, tokensRemaining, summarizeSession, exportCapsule, exportCapsuleToCwd }
export type { CapsuleAlert, ContextCapsule }

/**
 * Full pipeline: scan all sessions, detect alerts, and for critical ones
 * auto-generate + export capsules. Returns the list of generated capsules.
 */
export async function autoCapsuleSessions(
  sessions: SessionSummary[],
  outputDir?: string,
): Promise<Array<{ alert: CapsuleAlert; capsule: ContextCapsule; mdPath: string; jsonPath: string }>> {
  const alerts = detectAlerts(sessions)
  const criticalAlerts = alerts.filter(a => a.severity === 'critical')
  const results: Array<{ alert: CapsuleAlert; capsule: ContextCapsule; mdPath: string; jsonPath: string }> = []

  for (const alert of criticalAlerts) {
    const sess = sessions.find(s => s.sessionId === alert.sessionId)
    if (!sess) continue
    const capsule = summarizeSession(sess)
    const { mdPath, jsonPath } = await exportCapsule(capsule, outputDir).catch(() => ({
      mdPath: '(export failed)',
      jsonPath: '(export failed)',
    }))
    results.push({ alert, capsule, mdPath, jsonPath })
  }

  return results
}

/**
 * Generate a capsule for a specific session on demand.
 */
export async function capsuleSession(
  session: SessionSummary,
  toCwd = false,
  outputDir?: string,
): Promise<{ capsule: ContextCapsule; mdPath: string; jsonPath: string }> {
  const capsule = summarizeSession(session)
  const exported = toCwd
    ? await exportCapsuleToCwd(capsule)
    : await exportCapsule(capsule, outputDir)
  return { capsule, ...exported }
}
