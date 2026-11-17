import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist/server',
  sourcemap: true,
  clean: true,
  // Node 24's `node:sqlite` is a builtin. tsup strips the `node:` prefix by
  // default, which turns it into the non-existent `sqlite` package.
  removeNodeProtocol: false,
})