import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { backupDatabase } from './backup-db.mjs'

/** Restore only into a new data directory; replacing a live database is forbidden. */
export async function restoreDatabase(source, dataDirectory) {
  const directory = resolve(dataDirectory)
  const database = join(directory, 'relay-check.db')
  if (['', '-wal', '-shm'].some((suffix) => existsSync(database + suffix))) {
    throw new Error('目标目录已有数据库或 WAL 文件；请使用新的数据目录，并停止旧实例后切换 DATA_DIR')
  }
  return backupDatabase(source, database)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , source, directory] = process.argv
  if (!source || !directory) {
    console.error('用法: node scripts/restore-db.mjs <备份文件路径> <新的数据目录>')
    process.exitCode = 1
  } else {
    try {
      const path = await restoreDatabase(source, directory)
      console.log(`恢复完成: ${path}`)
      console.log('使用新的 DATA_DIR 启动单个实例，并检查 /api/v1/health 和测试记录。')
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
