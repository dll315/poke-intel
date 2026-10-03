import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

try {
  const source = resolve(process.env.DB_PATH || 'data/poke.db');
  const target = resolve(process.argv[2] || `backups/poke-${new Date().toISOString().replaceAll(':', '-')}.db`);
  if (!existsSync(source)) throw new Error('数据库不存在，请检查 DB_PATH。');
  if (existsSync(target)) throw new Error('备份文件已存在，请选择新文件名。');
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, target); chmodSync(target, 0o600); }
  finally { db.close(); }
  console.log(`备份完成：${target}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
