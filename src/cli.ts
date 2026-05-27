#!/usr/bin/env node
// Node version guard — must stay parseable by older Node versions.
const [major] = process.versions.node.split('.').map(Number)
if (major < 18) {
  process.stderr.write(
    `continuum requires Node.js >= 18.0.0 (current: ${process.version})\n` +
    'Upgrade at https://nodejs.org/\n',
  )
  process.exit(1)
}

import('./main.js').catch((err: unknown) => {
  process.stderr.write(String((err as Error)?.message ?? err) + '\n')
  process.exit(1)
})
