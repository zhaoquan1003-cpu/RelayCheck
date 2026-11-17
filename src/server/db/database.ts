import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new DatabaseSync(path)
  const migration = readFileSync(resolve(process.cwd(), 'migrations', '001_init.sql'), 'utf8')
  db.exec(migration)
  return db
}

export function databasePath(dataDir: string): string {
  return resolve(dataDir, 'relay-check.db')
}