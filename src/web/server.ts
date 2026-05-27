/**
 * Web Dashboard — HTTP Server
 *
 * Serves the self-contained dashboard HTML and a JSON API endpoint
 * that returns the full analytics payload (projects, capsule alerts,
 * prompt recommendations).
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectSummary } from '../types.js'
import { detectAlerts } from '../capsule/detector.js'
import { capsuleSession } from '../capsule/index.js'
import { topRecommendations } from '../recommendations/analyzer.js'
import { TEMPLATES } from '../recommendations/templates.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// ── Dashboard HTML ────────────────────────────────────────────────────────────

async function getDashboardHtml(): Promise<string> {
  // Try the source file first (dev mode), then the bundled dist
  const candidates = [
    join(__dirname, 'dashboard.html'),
    join(__dirname, '..', 'web', 'dashboard.html'),
    join(__dirname, '..', '..', 'src', 'web', 'dashboard.html'),
  ]
  for (const p of candidates) {
    const html = await readFile(resolve(p), 'utf-8').catch(() => null)
    if (html) return html
  }
  return '<html><body><h1>Dashboard not found</h1></body></html>'
}

// ── API data builder ──────────────────────────────────────────────────────────

function buildApiPayload(projects: ProjectSummary[]) {
  const allSessions = projects.flatMap(p => p.sessions)

  // Capsule alerts
  const capsuleAlerts = detectAlerts(allSessions)

  // Top prompt recommendations across all turns
  const allTurns = allSessions.flatMap(s => s.turns)
  const recommendations = topRecommendations(allTurns, 15)

  // Template texts for the frontend to render
  const templates: Record<string, string> = {}
  for (const t of TEMPLATES) {
    templates[t.name] = t.template
  }

  return {
    projects: projects.map(p => ({
      project: p.sessions[0]?.displayName ?? p.project,
      projectPath: p.projectPath,
      provider: p.provider,
      totalCostUSD: p.totalCostUSD,
      totalApiCalls: p.totalApiCalls,
      sessions: p.sessions.map(s => ({
        sessionId: s.sessionId,
        provider: s.provider,
        project: s.displayName,
        firstTimestamp: s.firstTimestamp,
        lastTimestamp: s.lastTimestamp,
        totalCostUSD: s.totalCostUSD,
        totalUsage: s.totalUsage,
        apiCalls: s.apiCalls,
        modelBreakdown: s.modelBreakdown,
        toolBreakdown: s.toolBreakdown,
        categoryBreakdown: s.categoryBreakdown,
        contextUtilization: Math.min(s.contextUtilization, 1),  // cap at 1 for display
        peakContextTokens: s.peakContextTokens,
        contextExceeded: s.contextUtilization > 1,              // flag if truly over limit
        // Last 15 turns for session detail modal (trimmed to keep payload small)
        turns: s.turns.slice(-15).map(t => ({
          category: t.category,
          model: t.model,
          costUSD: t.costUSD,
          userMessage: t.userMessage?.slice(0, 200) ?? '',
          inputTokens: t.usage.inputTokens,
          outputTokens: t.usage.outputTokens,
          tools: t.tools,
        })),
      })),
    })),
    capsuleAlerts,
    recommendations,
    templates,
    generatedAt: new Date().toISOString(),
  }
}

// ── Request handler ───────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body: string, contentType = 'text/plain') {
  res.writeHead(status, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' })
  res.end(body)
}

function sendJson(res: ServerResponse, data: unknown, status = 200) {
  send(res, status, JSON.stringify(data), 'application/json')
}

export type ServerOptions = {
  port: number
  projects: ProjectSummary[]
  /** Called when the user requests a capsule via the dashboard */
  onCapsuleRequest?: (sessionId: string) => Promise<{ mdPath: string; jsonPath: string } | null>
}

export function createDashboardServer(opts: ServerOptions) {
  const { port, projects } = opts

  // Mutable copy so we can refresh without restarting
  let currentProjects = projects

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = req.url ?? '/'

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' })
      res.end()
      return
    }

    // Dashboard HTML
    if (url === '/' || url === '/dashboard') {
      const html = await getDashboardHtml()
      send(res, 200, html, 'text/html; charset=utf-8')
      return
    }

    // JSON data API
    if (url === '/api/data' && req.method === 'GET') {
      const payload = buildApiPayload(currentProjects)
      sendJson(res, payload)
      return
    }

    // Capsule generation API
    if (url === '/api/capsule' && req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', c => chunks.push(c))
      req.on('end', async () => {
        let body: { sessionId?: string } = {}
        try { body = JSON.parse(Buffer.concat(chunks).toString()) } catch { /* ignore */ }

        if (!body.sessionId) {
          sendJson(res, { error: 'sessionId required' }, 400)
          return
        }

        // Find the session
        const allSessions = currentProjects.flatMap(p => p.sessions)
        const sess = allSessions.find(s => s.sessionId === body.sessionId)
        if (!sess) {
          sendJson(res, { error: 'Session not found' }, 404)
          return
        }

        try {
          const result = await capsuleSession(sess, false)
          sendJson(res, { mdPath: result.mdPath, jsonPath: result.jsonPath })
        } catch (e) {
          sendJson(res, { error: String(e) }, 500)
        }
      })
      return
    }

    // 404
    send(res, 404, 'Not found')
  }

  const server = createServer(handleRequest)

  return {
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.listen(port, '127.0.0.1', () => resolve())
        server.on('error', reject)
      })
    },
    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve())
      })
    },
    updateProjects(p: ProjectSummary[]) {
      currentProjects = p
    },
    get url() {
      return `http://localhost:${port}`
    },
  }
}
