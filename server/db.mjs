import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

export function openDb(dbPath='data/poke.db') {
  if(dbPath!==':memory:') mkdirSync(dirname(resolve(dbPath)),{recursive:true});
  const db=new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, nickname TEXT NOT NULL,
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
    CREATE TABLE IF NOT EXISTS notification_outbox (
      id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL UNIQUE REFERENCES events(id),
      state TEXT NOT NULL CHECK(state IN ('pending','sending','sent','failed','skipped')),
      attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, next_attempt_at INTEGER NOT NULL,
      attempted_at INTEGER, lease_until INTEGER, sent_at TEXT, last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS notification_links (
      id INTEGER PRIMARY KEY, label TEXT NOT NULL, webhook_ciphertext TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, categories TEXT NOT NULL DEFAULT '["boss","swarm","player","pheno"]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      event_id INTEGER NOT NULL REFERENCES events(id), destination_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','sending','sent','failed','skipped')),
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
      attempted_at INTEGER, lease_until INTEGER, sent_at INTEGER, last_error TEXT,
      PRIMARY KEY(event_id,destination_id)
    );
    CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due ON notification_deliveries(state,next_attempt_at);
    CREATE TABLE IF NOT EXISTS external_catalog (
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('boss','swarm')),
      pokemon TEXT NOT NULL, region TEXT NOT NULL, location TEXT NOT NULL,
      location_note TEXT NOT NULL DEFAULT '', tier INTEGER, national_dex INTEGER,
      hms TEXT NOT NULL DEFAULT '[]', moveset TEXT NOT NULL DEFAULT '[]', valuable INTEGER NOT NULL DEFAULT 0,
      pokemon_zh TEXT, source TEXT NOT NULL, source_url TEXT NOT NULL, source_key TEXT NOT NULL UNIQUE,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pheno_locations (
      id INTEGER PRIMARY KEY, area TEXT NOT NULL, type TEXT NOT NULL,
      detail TEXT NOT NULL, map_url TEXT, synced_at TEXT NOT NULL,
      UNIQUE(area,type,detail)
    );
    CREATE TABLE IF NOT EXISTS pokemon_names (
      english_name TEXT PRIMARY KEY COLLATE NOCASE, chinese_name TEXT NOT NULL, synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS move_names (
      english_name TEXT PRIMARY KEY COLLATE NOCASE, chinese_name TEXT NOT NULL, synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL,
      updated_by INTEGER REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS external_monitor_state (
      source TEXT PRIMARY KEY, last_checked_at TEXT, last_success_at TEXT,
      last_event_id TEXT, last_event_json TEXT, last_error TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_due ON notification_outbox(state,next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_reports_user_time ON reports(user_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status,created_at);
    CREATE INDEX IF NOT EXISTS idx_events_match ON events(kind,pokemon,region,location,status);
    CREATE INDEX IF NOT EXISTS idx_events_observed ON events(observed_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_catalog_filter ON external_catalog(kind,region,pokemon,location);
    CREATE INDEX IF NOT EXISTS idx_pheno_locations_type_area ON pheno_locations(type,area);
  `);
  if(!db.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='session_generation'))db.exec('ALTER TABLE users ADD COLUMN session_generation INTEGER NOT NULL DEFAULT 0');
  if(!db.prepare('PRAGMA table_info(users)').all().some(column=>column.name==='username')){
    const legacy=db.prepare('SELECT * FROM users ORDER BY id').all();
    const firstAdmin=legacy.find(row=>row.role==='admin');const taken=new Set();
    db.exec('PRAGMA foreign_keys=OFF');
    try{
      transaction(db,()=>{
        db.exec(`CREATE TABLE users_new (
          id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, nickname TEXT NOT NULL,
          password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','admin')),
          disabled INTEGER NOT NULL DEFAULT 0, session_generation INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
        )`);
        const insert=db.prepare('INSERT INTO users_new(id,username,nickname,password_hash,role,disabled,session_generation,created_at) VALUES(?,?,?,?,?,?,?,?)');
        for(const row of legacy){
          const base=row.id===firstAdmin?.id?'admin':String(row.email||'').split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,30);
          let username=base.length>=3&&base!=='admin'?base:row.id===firstAdmin?.id?'admin':`user${row.id}`;
          if(taken.has(username))username=`user${row.id}`;taken.add(username);
          insert.run(row.id,username,row.nickname,row.password_hash,row.role,row.disabled,row.session_generation,row.created_at);
        }
        db.exec('DROP TABLE users; ALTER TABLE users_new RENAME TO users');
        if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('用户账号迁移后关联数据校验失败');
      });
    }finally{db.exec('PRAGMA foreign_keys=ON');}
  }
  if(!db.prepare('PRAGMA table_info(external_catalog)').all().some(column=>column.name==='pokemon_zh'))db.exec('ALTER TABLE external_catalog ADD COLUMN pokemon_zh TEXT');
  if(!db.prepare('PRAGMA table_info(external_catalog)').all().some(column=>column.name==='moveset'))db.exec("ALTER TABLE external_catalog ADD COLUMN moveset TEXT NOT NULL DEFAULT '[]'");
  if(!db.prepare('PRAGMA table_info(notification_links)').all().some(column=>column.name==='categories'))db.exec(`ALTER TABLE notification_links ADD COLUMN categories TEXT NOT NULL DEFAULT '["boss","swarm","player","pheno"]'`);
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
