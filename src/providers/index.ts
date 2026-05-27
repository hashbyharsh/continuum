import { claude } from './claude.js'
import { cline } from './cline.js'
import { codex } from './codex.js'
import { copilot } from './copilot.js'
import { gemini } from './gemini.js'
import { kimi } from './kimi.js'
import { rooCode } from './roo-code.js'
import { opencode } from './opencode.js'
import type { Provider, SessionSource } from './types.js'

export type { Provider, SessionSource }
export { claude, cline, codex, copilot, gemini, kimi, rooCode, opencode }

/** All registered providers */
export const ALL_PROVIDERS: Provider[] = [
  claude,
  cline,
  codex,
  copilot,
  gemini,
  kimi,
  rooCode,
  opencode,
]

export function getProvider(name: string): Provider | undefined {
  return ALL_PROVIDERS.find(p => p.name === name)
}

export async function discoverAllSessions(providerFilter?: string): Promise<SessionSource[]> {
  const providers = providerFilter && providerFilter !== 'all'
    ? ALL_PROVIDERS.filter(p => p.name === providerFilter)
    : ALL_PROVIDERS

  const all: SessionSource[] = []
  await Promise.all(
    providers.map(async p => {
      const sessions = await p.discoverSessions().catch(() => [])
      all.push(...sessions)
    }),
  )
  return all
}
