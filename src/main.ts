import { Command } from 'commander'
import chalk from 'chalk'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { parseAllSessions } from './parser.js'
import { detectAlerts } from './capsule/detector.js'
import { capsuleSession, summarizeSession } from './capsule/index.js'
import { topRecommendations } from './recommendations/analyzer.js'
import { TEMPLATES, getTemplatesForCategory } from './recommendations/templates.js'
import { createDashboardServer } from './web/server.js'
import {
  printBanner,
  printProjectSummary,
  printCapsuleAlerts,
  printRecommendations,
  fmtCost,
  fmtNum,
  fmtPct,
  fmtDate,
} from './format.js'
import type { DateRange } from './types.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json') as { version: string }

// ── Date range helper ─────────────────────────────────────────────────────────

function parseDaysFlag(days: string | undefined): DateRange | undefined {
  if (!days) return undefined
  const n = parseInt(days, 10)
  if (isNaN(n) || n <= 0) return undefined
  const end = new Date()
  const start = new Date(end.getTime() - n * 24 * 60 * 60 * 1000)
  return { start, end }
}

// ── Program ───────────────────────────────────────────────────────────────────

const program = new Command()

program
  .name('continuum')
  .description('Seamless AI session continuity — token analytics, Context Capsule & Prompt Recommendations')
  .version(version)

// ── `stats` (default) ─────────────────────────────────────────────────────────

program
  .command('stats', { isDefault: true })
  .description('Show token usage stats across all providers')
  .option('-p, --provider <name>', 'Filter to a single provider')
  .option('-d, --days <n>', 'Only include sessions from the last N days')
  .option('--json', 'Output raw JSON')
  .action(async (opts: { provider?: string; days?: string; json?: boolean }) => {
    printBanner(version)
    console.log(chalk.dim('Scanning sessions…\n'))

    const dateRange = parseDaysFlag(opts.days)
    const projects = await parseAllSessions(dateRange, opts.provider)

    if (opts.json) {
      console.log(JSON.stringify(projects, null, 2))
      return
    }

    printProjectSummary(projects)

    // Quick capsule + recommendation summary
    const allSessions = projects.flatMap(p => p.sessions)
    const alerts = detectAlerts(allSessions)
    if (alerts.length > 0) {
      console.log(chalk.yellow(`⚠️  ${alerts.length} session(s) approaching context limits.`) +
        chalk.dim(' Run `continuum capsule` for details.'))
      console.log('')
    }

    const allTurns = allSessions.flatMap(s => s.turns)
    const recs = topRecommendations(allTurns, 3)
    if (recs.length > 0) {
      console.log(chalk.blue(`💡 ${recs.length} prompt improvement(s) detected.`) +
        chalk.dim(' Run `continuum recommend` for details.'))
      console.log('')
    }
  })

// ── `web` ─────────────────────────────────────────────────────────────────────

program
  .command('web')
  .description('Launch the interactive web dashboard')
  .option('-p, --port <n>', 'Port to listen on', '3737')
  .option('--provider <name>', 'Filter to a single provider')
  .option('--days <n>', 'Only include sessions from the last N days')
  .option('--no-open', 'Do not auto-open the browser')
  .action(async (opts: { port: string; provider?: string; days?: string; open: boolean }) => {
    printBanner(version)
    console.log(chalk.dim('Loading sessions…'))

    const dateRange = parseDaysFlag(opts.days)
    const projects = await parseAllSessions(dateRange, opts.provider)

    const port = parseInt(opts.port, 10) || 3737
    const server = createDashboardServer({ port, projects })

    await server.start()
    const url = server.url

    console.log(`\n${chalk.bold.hex('#6c63ff')('⚡ Dashboard running')} at ${chalk.cyan.underline(url)}`)
    console.log(chalk.dim(`  Loaded ${projects.length} projects · ${projects.reduce((s, p) => s + p.sessions.length, 0)} sessions`))
    console.log(chalk.dim('  Press Ctrl+C to stop\n'))

    if (opts.open) {
      // Try to open browser
      const { exec } = await import('node:child_process')
      const cmd = process.platform === 'darwin' ? `open ${url}`
        : process.platform === 'win32' ? `start ${url}`
        : `xdg-open ${url}`
      exec(cmd, () => { /* ignore errors */ })
    }

    // Keep running + refresh data every 60s
    setInterval(async () => {
      try {
        const refreshed = await parseAllSessions(dateRange, opts.provider)
        server.updateProjects(refreshed)
      } catch { /* ignore */ }
    }, 60_000)

    // Wait for SIGINT
    await new Promise<void>(res => process.on('SIGINT', () => res()))
    await server.stop()
    console.log('\nDashboard stopped.')
  })

// ── `capsule` ─────────────────────────────────────────────────────────────────

program
  .command('capsule')
  .description('Detect context pressure and generate handoff capsules')
  .option('--session <id>', 'Generate capsule for a specific session ID')
  .option('--provider <name>', 'Filter to a single provider')
  .option('--days <n>', 'Only include sessions from the last N days')
  .option('--cwd', 'Write capsule files to the current directory')
  .option('--json', 'Output capsule as JSON')
  .action(async (opts: { session?: string; provider?: string; days?: string; cwd?: boolean; json?: boolean }) => {
    printBanner(version)
    console.log(chalk.dim('Scanning sessions for context pressure…\n'))

    const dateRange = parseDaysFlag(opts.days)
    const projects = await parseAllSessions(dateRange, opts.provider)
    const allSessions = projects.flatMap(p => p.sessions)

    if (opts.session) {
      // Specific session capsule
      const sess = allSessions.find(s => s.sessionId === opts.session || s.sessionId.startsWith(opts.session!))
      if (!sess) {
        console.error(chalk.red(`Session "${opts.session}" not found.`))
        process.exit(1)
      }

      if (opts.json) {
        const capsule = summarizeSession(sess)
        console.log(JSON.stringify(capsule, null, 2))
        return
      }

      console.log(chalk.dim(`Generating capsule for session ${sess.sessionId.slice(0, 16)}…`))
      const result = await capsuleSession(sess, opts.cwd ?? false)
      console.log(chalk.green('\n✅ Capsule generated!\n'))
      console.log(`  Markdown: ${chalk.cyan(result.mdPath)}`)
      console.log(`  JSON:     ${chalk.cyan(result.jsonPath)}`)
      console.log('')
      console.log(chalk.dim('Copy the "Continuation Prompt" section from the Markdown file and paste'))
      console.log(chalk.dim('it as your first message in a new session with a fresh model.'))
      return
    }

    // Auto-detect alerts
    const alerts = detectAlerts(allSessions)

    if (opts.json) {
      console.log(JSON.stringify(alerts, null, 2))
      return
    }

    printCapsuleAlerts(alerts)

    // Auto-generate capsules for critical sessions
    const critical = alerts.filter(a => a.severity === 'critical')
    if (critical.length > 0) {
      console.log(chalk.dim(`Auto-generating ${critical.length} capsule(s) for critical sessions…\n`))
      for (const a of critical) {
        const sess = allSessions.find(s => s.sessionId === a.sessionId)
        if (!sess) continue
        try {
          const result = await capsuleSession(sess, opts.cwd ?? false)
          console.log(`  ✅ ${chalk.bold(a.project)} → ${chalk.cyan(result.mdPath)}`)
        } catch (e) {
          console.log(`  ❌ ${chalk.bold(a.project)} → ${chalk.red(String(e))}`)
        }
      }
      console.log('')
    }
  })

// ── `recommend` ───────────────────────────────────────────────────────────────

program
  .command('recommend')
  .description('Show prompt optimization recommendations from your sessions')
  .option('--provider <name>', 'Filter to a single provider')
  .option('--days <n>', 'Only include sessions from the last N days')
  .option('-n, --limit <n>', 'Max number of recommendations', '10')
  .option('--templates', 'List all available prompt templates')
  .option('--category <cat>', 'Show templates for a specific category')
  .option('--json', 'Output as JSON')
  .action(async (opts: { provider?: string; days?: string; limit: string; templates?: boolean; category?: string; json?: boolean }) => {
    printBanner(version)

    // Template listing mode
    if (opts.templates || opts.category) {
      const cat = opts.category as Parameters<typeof getTemplatesForCategory>[0] | undefined
      const templates = cat ? getTemplatesForCategory(cat) : TEMPLATES
      if (opts.json) {
        console.log(JSON.stringify(templates, null, 2))
        return
      }
      console.log(chalk.bold(`\nPrompt Templates${cat ? ` — ${cat}` : ''} (${templates.length})\n`))
      for (const t of templates) {
        console.log(chalk.bold(`[${t.name}]`) + chalk.dim(` ${t.category} · ~${t.estimatedTokens} tokens`))
        console.log(chalk.dim(`  ${t.description}`))
        console.log('')
        const lines = t.template.split('\n')
        for (const l of lines) console.log(`  ${chalk.cyan(l)}`)
        console.log('')
      }
      return
    }

    console.log(chalk.dim('Analyzing prompts across sessions…\n'))
    const dateRange = parseDaysFlag(opts.days)
    const projects = await parseAllSessions(dateRange, opts.provider)
    const allTurns = projects.flatMap(p => p.sessions).flatMap(s => s.turns)
    const limit = parseInt(opts.limit, 10) || 10
    const recs = topRecommendations(allTurns, limit)

    if (opts.json) {
      console.log(JSON.stringify(recs, null, 2))
      return
    }

    printRecommendations(recs)

    if (recs.length > 0) {
      console.log(chalk.dim(`\nUse ${chalk.cyan('continuum recommend --templates')} to see all available templates.`))
    }
  })

// ── `providers` ───────────────────────────────────────────────────────────────

program
  .command('providers')
  .description('List all supported providers and detected session counts')
  .action(async () => {
    printBanner(version)
    const { ALL_PROVIDERS } = await import('./providers/index.js')
    console.log(chalk.bold('Supported Providers:\n'))
    for (const p of ALL_PROVIDERS) {
      const sessions = await p.discoverSessions().catch(() => [])
      const found = sessions.length > 0
      const icon = found ? chalk.green('✓') : chalk.dim('○')
      console.log(`  ${icon} ${chalk.bold(p.displayName)} ${chalk.dim(`(${p.name})`)} — ${found ? chalk.green(sessions.length + ' session dir(s)') : chalk.dim('not found')}`)
    }
    console.log('')
  })

program.parseAsync()
