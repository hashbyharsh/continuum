import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  splitting: false,
  bundle: true,
  minify: false,
  sourcemap: false,
  // Inline the web dashboard HTML at build time
  loader: { '.html': 'text' },
})
