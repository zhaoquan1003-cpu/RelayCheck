import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/server/db/database'
import { loadConfig } from '../../src/server/config'
import { createApp } from '../../src/server/app'

vi.mock('@fastify/static', () => ({
  default: async function brokenStaticPlugin() { throw new Error('simulated static plugin startup failure') },
}))

describe('startup resource cleanup', () => {
  it('closes an opened database when migration execution fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'relaycheck-invalid-migration-'))
    mkdirSync(join(directory, 'migrations'))
    writeFileSync(join(directory, 'migrations', '001_init.sql'), 'INVALID SQL FOR MIGRATION TEST;')
    let database: DatabaseSync | undefined
    const originalExec = DatabaseSync.prototype.exec
    const exec = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql) {
      database = this
      return originalExec.call(this, sql)
    })
    const close = vi.spyOn(DatabaseSync.prototype, 'close')
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory)
    try {
      expect(() => openDatabase(':memory:')).toThrow()
      expect(close).toHaveBeenCalledOnce()
      expect(database?.isOpen).toBe(false)
    } finally {
      cwd.mockRestore()
      exec.mockRestore()
      close.mockRestore()
      if (database?.isOpen) database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('closes the database when app plugin registration fails after initialization', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'relaycheck-failed-startup-'))
    mkdirSync(join(directory, 'migrations'))
    mkdirSync(join(directory, 'dist', 'client'), { recursive: true })
    writeFileSync(join(directory, 'migrations', '001_init.sql'), readFileSync(join(process.cwd(), 'migrations', '001_init.sql')))
    let database: DatabaseSync | undefined
    const originalExec = DatabaseSync.prototype.exec
    const exec = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql) {
      database = this
      return originalExec.call(this, sql)
    })
    const close = vi.spyOn(DatabaseSync.prototype, 'close')
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory)
    try {
      await expect(createApp(loadConfig({ NODE_ENV: 'test', DATA_DIR: directory }))).rejects.toThrow('simulated static plugin startup failure')
      expect(close).toHaveBeenCalledOnce()
      expect(database?.isOpen).toBe(false)
    } finally {
      cwd.mockRestore()
      exec.mockRestore()
      close.mockRestore()
      if (database?.isOpen) database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
