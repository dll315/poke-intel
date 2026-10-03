import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const run = (name, args, db) => spawnSync(process.execPath, [`scripts/${name}.mjs`, ...args], {
  encoding: 'utf8', env: { ...process.env, DB_PATH: db }, timeout: 15000,
});

test('backup preserves committed WAL data and refuses to overwrite an existing backup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poke-ops-'));
  const source = join(dir, 'source.db'); const target = join(dir, 'backup.db');
  const db = new DatabaseSync(source);
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES('saved');");
    const first = run('backup', [target], source);
    assert.equal(first.status, 0, first.stderr);
    const copy = new DatabaseSync(target, { readOnly: true });
    assert.equal(copy.prepare('SELECT value FROM sample').get().value, 'saved'); copy.close();
    const again = run('backup', [target], source);
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /已存在/);
  } finally { db.close(); rmSync(dir, {recursive: true, force: true}); }
});

test('restore requires explicit stopped-server confirmation and rejects invalid SQLite input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poke-restore-'));
  const target = join(dir, 'restored.db'); const backup = join(dir, 'valid.db');
  const db = new DatabaseSync(backup); db.exec('CREATE TABLE sample(value TEXT);'); db.close();
  try {
    assert.notEqual(run('restore', [backup], target).status, 0);
    assert.equal(existsSync(target), false);
    const ok = run('restore', [backup, '--confirm-server-stopped'], target);
    assert.equal(ok.status, 0, ok.stderr);
    const old = readFileSync(target);
    const bad = join(dir, 'bad.db'); writeFileSync(bad, 'not a database');
    assert.notEqual(run('restore', [bad, '--confirm-server-stopped', '--overwrite'], target).status, 0);
    assert.deepEqual(readFileSync(target), old);
    assert.notEqual(run('restore', [backup, '--confirm-server-stopped'], target).status, 0);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
