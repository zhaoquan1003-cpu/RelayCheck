import { copyFileSync, constants, closeSync, existsSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { DatabaseSync, backup } from 'node:sqlite'

/** SQLite's online backup includes committed WAL data and never overwrites a backup. */
export async function backupDatabase(source, destination) {
  const sourcePath = resolve(source)
  const destinationPath = resolve(destination)
  if (sourcePath === destinationPath) throw new Error('源数据库和备份文件不能相同')
  if (!existsSync(sourcePath)) throw new Error('源数据库不存在')
  if (existsSync(destinationPath)) throw new Error('目标文件已存在；请选择新的文件名')
  mkdirSync(dirname(destinationPath), { recursive: true })
  const partial = `${destinationPath}.${randomUUID()}.partial`
  const db = new DatabaseSync(sourcePath, { readOnly: true })
  try {
    const check = db.prepare('PRAGMA quick_check').get()
    if (check.quick_check !== 'ok') throw new Error('源数据库完整性检查未通过')
    closeSync(openSync(partial, 'wx', 0o600))
    await backup(db, partial)
    copyFileSync(partial, destinationPath, constants.COPYFILE_EXCL)
    return destinationPath
  } finally {
    db.close()
    rmSync(partial, { force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , source, destination] = process.argv
  if (!source || !destination) {
    console.error('用法: node scripts/backup-db.mjs <源数据库路径> <新备份文件路径>')
    process.exitCode = 1
  } else {
    try {
      const path = await backupDatabase(source, destination)
      console.log(`备份完成: ${path}`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
