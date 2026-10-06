import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

test('admin CLI accepts password through stdin without exposing it and preserves ordinary account password', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poke-admin-'));
  const path = join(dir, 'users.db');
  const secret = 'local-test-secret-6427';
  try {
    const result = spawnSync(process.execPath, ['scripts/admin.mjs', 'owner', '管理员'], {
      encoding: 'utf8', input: `${secret}\n`, env: {...process.env, DB_PATH:path}, timeout:15000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((result.stdout+result.stderr).includes(secret), false);
    const db = new DatabaseSync(path);
    try {
      const user = db.prepare('SELECT * FROM users WHERE username=?').get('owner');
      assert.equal(user.role, 'admin');
      assert.equal(JSON.stringify(user).includes(secret), false);
      const hash = user.password_hash;
      db.prepare("UPDATE users SET role='user' WHERE id=?").run(user.id);
      const promoted = spawnSync(process.execPath, ['scripts/admin.mjs', 'owner'], {
        encoding: 'utf8', input: '', env: {...process.env, DB_PATH:path}, timeout:15000,
      });
      assert.equal(promoted.status, 0, promoted.stderr);
      const after = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
      assert.equal(after.role, 'admin');
      assert.equal(after.password_hash, hash);
      const log = db.prepare("SELECT * FROM audit_logs WHERE action='user.cli-promote' AND entity_id=?").get(user.id);
      assert.ok(log, 'CLI role and account-state changes must be audited');
      const reset=spawnSync(process.execPath,['scripts/admin.mjs','owner','管理员','--reset-password'],{
        encoding:'utf8',input:'123456\n',env:{...process.env,DB_PATH:path},timeout:15000,
      });
      assert.equal(reset.status,0,reset.stderr);
      assert.equal((reset.stdout+reset.stderr).includes('123456'),false);
      const updated=db.prepare('SELECT password_hash,session_generation FROM users WHERE id=?').get(user.id);
      assert.notEqual(updated.password_hash,hash);
      assert.equal(updated.session_generation,1);
    } finally { db.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
