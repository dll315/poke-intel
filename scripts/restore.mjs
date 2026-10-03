import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, copyFileSync, renameSync, rmSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

try {
  const args = process.argv.slice(2);
  if (!args.includes('--confirm-server-stopped')) throw new Error('请先停止应用，再添加 --confirm-server-stopped 确认。');
  const sourceArg = args.find(arg => !arg.startsWith('--'));
  if (!sourceArg) throw new Error('请提供备份文件路径。');
  const source = resolve(sourceArg); const target = resolve(process.env.DB_PATH || 'data/poke.db');
  if (source === target) throw new Error('备份文件与目标数据库不能相同。');
  if (!existsSync(source)) throw new Error('备份文件不存在。');
  if (existsSync(target) && !args.includes('--overwrite')) throw new Error('数据库已存在；确认覆盖时请添加 --overwrite。');
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('备份完整性校验失败。');
  } finally { db.close(); }
  mkdirSync(dirname(target), {recursive: true, mode: 0o700});
  const staged = `${target}.${randomUUID()}.restore`;
  try {
    copyFileSync(source, staged); chmodSync(staged, 0o600);
    renameSync(staged, target);
    for (const suffix of ['-wal', '-shm']) rmSync(`${target}${suffix}`, {force: true});
  } finally { rmSync(staged, {force: true}); }
  console.log(`恢复完成：${target}。现在可以重新启动应用。`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
