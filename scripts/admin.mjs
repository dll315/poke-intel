import { openDb, transaction, audit } from '../server/db.mjs';
import { createUser, hashPassword } from '../server/auth.mjs';

async function readPassword() {
  if (!process.stdin.isTTY) {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk.toString();
      if (input.length > 1024) throw new Error('密码输入过长。');
    }
    return input.replace(/[\r\n]+$/, '');
  }
  process.stdout.write('请输入管理员密码（输入不显示）：');
  process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => { process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\u0003') { finish(); reject(new Error('操作取消。')); return; }
        if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && value.length < 129) value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

try {
  const [usernameArg, nickname = '管理员', flag] = process.argv.slice(2);
  const username = usernameArg?.trim().toLowerCase();
  if (!username || !/^[a-z0-9_-]{3,30}$/.test(username)) throw new Error('用法：npm run admin -- 用户名 昵称 [--reset-password]');
  if(flag && flag!=='--reset-password')throw new Error('未知参数');
  if (!nickname.trim() || nickname.length > 30) throw new Error('昵称长度须为 1–30 个字符。');
  const db = openDb(process.env.DB_PATH || 'data/poke.db');
  try {
    const existing = db.prepare('SELECT id,role,disabled FROM users WHERE username=?').get(username);
    if (existing) {
      const password=flag==='--reset-password'?await readPassword():null;
      if(password!==null&&(password.length<6||password.length>128))throw new Error('管理员密码长度须为 6–128 个字符。');
      transaction(db, () => {
        db.prepare("UPDATE users SET role='admin', disabled=0, password_hash=COALESCE(?,password_hash), session_generation=session_generation+? WHERE id=?").run(password===null?null:hashPassword(password),password===null?0:1,existing.id);
        if(password!==null)db.prepare('DELETE FROM sessions WHERE user_id=?').run(existing.id);
        audit(db,null,'user.cli-promote','user',existing.id,{origin:'admin-cli',previousRole:existing.role,previousDisabled:Boolean(existing.disabled)},new Date().toISOString());
      });
      console.log(password===null?'现有账号已提升为管理员，原密码保持不变。':'管理员密码已重设，旧登录会话已退出。');
    } else {
      const password = await readPassword();
      if (password.length < 6 || password.length > 128) throw new Error('管理员密码长度须为 6–128 个字符。');
      transaction(db, () => {
        const user = createUser(db, {username,nickname:nickname.trim(),password,role:'admin'});
        audit(db,null,'user.cli-create','user',user.id,{origin:'admin-cli'},new Date().toISOString());
      });
      console.log('管理员已创建，请在网页使用用户名和密码登录。');
    }
  } finally { db.close(); }
} catch (error) { console.error(error.message); process.exitCode = 1; }
