import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseGenericSessionDir } from './generic-jsonl.js'
import type { Provider, SessionSource, RawProviderCall } from './types.js'

function getClineDir(): string {
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks')
  if (process.platform === 'win32')
    return join(homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks')
  return join(homedir(), '.config', 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks')
}

export const cline: Provider = {
  name: 'cline',
  displayName: 'Cline',

  async discoverSessions(): Promise<SessionSource[]> {
    const base = getClineDir()
    const entries = await readdir(base).catch(() => [])
    const sources: SessionSource[] = []
    for (const entry of entries) {
      const full = join(base, entry)
      if ((await stat(full).catch(() => null))?.isDirectory()) {
        sources.push({ path: full, project: entry, provider: 'cline' })
      }
    }
    return sources
  },

  async *parseSession(source: SessionSource, seenKeys: Set<string>): AsyncGenerator<RawProviderCall> {
    yield* parseGenericSessionDir(source.path, 'cline', source.project, seenKeys, 'claude-sonnet-4-5')
  },
}
