import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

export function openDb(dbPath='data/poke.db') {
  if(dbPath!==':memory:') mkdirSync(dirname(resolve(dbPath)),{recursive:true});
  const db=new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','admin')),
      disabled INTEGER NOT NULL DEFAULT 0, session_generation INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, pokemon TEXT NOT NULL, region TEXT NOT NULL,
      location TEXT NOT NULL, observed_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      last_confirmed_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      source TEXT NOT NULL, source_url TEXT, note TEXT NOT NULL DEFAULT '', correction_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), kind TEXT NOT NULL,
      pokemon TEXT NOT NULL, region TEXT NOT NULL, location TEXT NOT NULL, observed_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', reason TEXT,
      event_id INTEGER REFERENCES events(id), source TEXT NOT NULL DEFAULT 'player', source_url TEXT,
      source_event_id TEXT, suggested_expires_at TEXT, created_at TEXT NOT NULL,
      UNIQUE(source,source_event_id)
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reports_user_time ON reports(user_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status,created_at);
    CREATE INDEX IF NOT EXISTS idx_events_match ON events(kind,pokemon,region,location,status);
    CREATE INDEX IF NOT EXISTS idx_events_observed ON events(observed_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);
  if(!db.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='session_generation'))db.exec('ALTER TABLE users ADD COLUMN session_generation INTEGER NOT NULL DEFAULT 0');
  return db;
}

export function transaction(db,fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result=fn();db.exec('COMMIT');return result; }
  catch(error){db.exec('ROLLBACK');throw error;}
}
export function audit(db,actorId,action,entityType,entityId,details,at) {
  db.prepare('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details,created_at) VALUES(?,?,?,?,?,?)')
    .run(actorId,action,entityType,entityId,JSON.stringify(details),at);
}
