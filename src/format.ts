/**
 * CLI output formatting helpers.
 * Uses chalk for colour and keeps terminal output readable.
 */
import chalk from 'chalk'
import type { ProjectSummary, SessionSummary } from './types.js'
import type { CapsuleAlert } from './types.js'
import type { PromptRecommendation } from './types.js'

// ── Numbers ───────────────────────────────────────────────────────────────────

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K'
  return n.toString()
}

export function fmtCost(c: number): string {
  return '$' + c.toFixed(4)
}

export function fmtPct(p: number): string {
  return Math.round(p * 100) + '%'
}

export function fmtDate(ts: string): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ── Terminal banner ───────────────────────────────────────────────────────────

export function printBanner(version: string): void {
  console.log('')
  console.log(chalk.bold.hex('#6c63ff')('◈ Continuum') + chalk.dim(` v${version}`))
  console.log(chalk.dim('Seamless AI session continuity — token analytics, Context Capsule & Prompt Tips'))
  console.log('')
}

// ── Summary table ─────────────────────────────────────────────────────────────

export function printProjectSummary(projects: ProjectSummary[]): void {
  if (projects.length === 0) {
    console.log(chalk.yellow('No sessions found. Make sure you have AI coding tools installed.'))
    return
  }

  const totalCost = projects.reduce((s, p) => s + p.totalCostUSD, 0)
  const totalCalls = projects.reduce((s, p) => s + p.totalApiCalls, 0)

  console.log(chalk.bold('─────────────────────────────────────────────────────────────'))
  console.log(
    chalk.bold(padR('PROJECT', 30)) +
    chalk.bold(padR('PROVIDER', 12)) +
    chalk.bold(padR('SESSIONS', 10)) +
    chalk.bold(padR('CALLS', 8)) +
    chalk.bold(padR('INPUT', 10)) +
    chalk.bold('COST'),
  )
  console.log('─────────────────────────────────────────────────────────────')

  for (const p of projects.sort((a, b) => b.totalCostUSD - a.totalCostUSD)) {
    const inputTokens = p.sessions.reduce((s, s2) => s + s2.totalUsage.inputTokens, 0)
    console.log(
      padR(p.project.slice(0, 28), 30) +
      chalk.dim(padR(p.provider, 12)) +
      padR(p.sessions.length.toString(), 10) +
      padR(fmtNum(p.totalApiCalls), 8) +
      padR(fmtNum(inputTokens), 10) +
      chalk.green(fmtCost(p.totalCostUSD)),
    )
  }

  console.log('─────────────────────────────────────────────────────────────')
  console.log(
    padR(chalk.bold('TOTAL'), 30) +
    '            ' +
    padR(projects.reduce((s, p) => s + p.sessions.length, 0).toString(), 10) +
    padR(fmtNum(totalCalls), 8) +
    '          ' +
    chalk.bold.green(fmtCost(totalCost)),
  )
  console.log('')
}

// ── Capsule alerts ────────────────────────────────────────────────────────────

export function printCapsuleAlerts(alerts: CapsuleAlert[]): void {
  if (alerts.length === 0) {
    console.log(chalk.green('✓ No sessions approaching context limits.'))
    return
  }

  console.log(chalk.bold(`\n Context Capsule Alerts (${alerts.length})\n`))
  for (const a of alerts) {
    const pct = Math.round(a.utilization * 100)
    const color = a.severity === 'critical' ? chalk.red : chalk.yellow
    const badge = a.severity === 'critical'
      ? chalk.bgRed.white(' CRITICAL ')
      : chalk.bgYellow.black(' WARNING  ')

    console.log(`${badge} ${chalk.bold(a.project)} · ${chalk.dim(a.provider)} · ${a.model}`)
    console.log(`  Context: ${color(`${pct}%`)} used  (${fmtNum(a.totalContextTokens)} / ${fmtNum(a.contextWindowSize)} tokens)`)
    console.log(`  Session: ${chalk.dim(a.sessionId.slice(0, 16))}…`)
    console.log(`  Run: ${chalk.cyan(`token-optimizer capsule --session ${a.sessionId}`)}`)
    console.log('')
  }
}

// ── Recommendations ───────────────────────────────────────────────────────────

export function printRecommendations(recs: PromptRecommendation[]): void {
  if (recs.length === 0) {
    console.log(chalk.green('✓ No prompt inefficiencies detected. Looking good!'))
    return
  }

  console.log(chalk.bold(`\n Prompt Recommendations (${recs.length})\n`))
  for (const rec of recs) {
    const sev = rec.severity === 'high' ? chalk.red : rec.severity === 'medium' ? chalk.yellow : chalk.blue
    console.log(`${sev(`[${rec.severity.toUpperCase()}]`)} ${chalk.bold(rec.templateDescription)}`)
    console.log(`  ${chalk.dim(rec.description)}`)
    console.log(`  Estimated saving: ${chalk.green('~' + rec.estimatedSavingPercent + '%')} tokens`)
    if (rec.originalSnippet) {
      console.log(`  Detected in: "${chalk.dim(rec.originalSnippet.slice(0, 80))}${rec.originalSnippet.length > 80 ? '…' : ''}"`)
    }
    console.log(`  Template (${chalk.cyan(rec.templateName)}):`)
    console.log('')
  }
}

// ── Padding helper ────────────────────────────────────────────────────────────

function padR(s: string, n: number): string {
  // Strip ANSI codes for length calculation
  const stripped = s.replace(/\x1B\[[0-9;]*m/g, '')
  const pad = Math.max(0, n - stripped.length)
  return s + ' '.repeat(pad)
}
