import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseGenericSessionDir } from './generic-jsonl.js'
import type { Provider, SessionSource, RawProviderCall } from './types.js'

function getRooCodeDir(): string {
  if (process.platform === 'darwin')
    return join(homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'tasks')
  if (process.platform === 'win32')
    return join(homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'tasks')
  return join(homedir(), '.config', 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'tasks')
}

export const rooCode: Provider = {
  name: 'roo-code',
  displayName: 'Roo Code',

  async discoverSessions(): Promise<SessionSource[]> {
    const base = getRooCodeDir()
    const entries = await readdir(base).catch(() => [])
    const sources: SessionSource[] = []
    for (const entry of entries) {
      const full = join(base, entry)
      if ((await stat(full).catch(() => null))?.isDirectory()) {
        sources.push({ path: full, project: entry, provider: 'roo-code' })
      }
    }
    return sources
  },

  async *parseSession(source: SessionSource, seenKeys: Set<string>): AsyncGenerator<RawProviderCall> {
    yield* parseGenericSessionDir(source.path, 'roo-code', source.project, seenKeys, 'claude-sonnet-4-5')
  },
}
