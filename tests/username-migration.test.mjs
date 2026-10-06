import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openDb} from '../server/db.mjs';

test('legacy accounts migrate to usernames while preserving IDs and linked sessions',()=>{
  const dir=mkdtempSync(join(tmpdir(),'poke-username-migration-')),path=join(dir,'old.db');
  try{
    const old=new DatabaseSync(path);
    old.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL UNIQUE,nickname TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,session_generation INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),csrf_token TEXT NOT NULL,expires_at TEXT NOT NULL)");
    old.prepare('INSERT INTO users(id,email,nickname,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(7,'owner@example.test','旧管理员','hash','admin','2026-10-01T00:00:00Z');
    old.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)').run('token',7,'csrf','2026-11-01T00:00:00Z');old.close();
    const db=openDb(path);
    assert.equal(db.prepare('SELECT username FROM users WHERE id=7').get().username,'admin');
    assert.equal(db.prepare('SELECT user_id FROM sessions WHERE token_hash=?').get('token').user_id,7);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.equal(db.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='email'),false);
    db.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
