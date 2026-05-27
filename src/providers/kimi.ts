import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseGenericSessionDir } from './generic-jsonl.js'
import type { Provider, SessionSource, RawProviderCall } from './types.js'

function getKimiDir(): string {
  return join(homedir(), '.kimi')
}

export const kimi: Provider = {
  name: 'kimi',
  displayName: 'Kimi',

  async discoverSessions(): Promise<SessionSource[]> {
    const base = join(getKimiDir(), 'sessions')
    const entries = await readdir(base).catch(() => [])
    const sources: SessionSource[] = []
    for (const entry of entries) {
      const full = join(base, entry)
      if ((await stat(full).catch(() => null))?.isDirectory()) {
        sources.push({ path: full, project: entry, provider: 'kimi' })
      }
    }
    return sources
  },

  async *parseSession(source: SessionSource, seenKeys: Set<string>): AsyncGenerator<RawProviderCall> {
    yield* parseGenericSessionDir(source.path, 'kimi', source.project, seenKeys, 'kimi-k2')
  },
}
