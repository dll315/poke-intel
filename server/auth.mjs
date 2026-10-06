import {randomBytes,scryptSync,scrypt,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {parse,registration,adminRegistration,credentials,ApiError} from './validation.mjs';

const asyncScrypt=promisify(scrypt);
export const safeUser=row=>({id:row.id,username:row.username,nickname:row.nickname,role:row.role,disabled:Boolean(row.disabled)});
export const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export function hashPassword(password){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function createUser(db,{username,nickname,password,role='user'}) {
  const data=parse(role==='admin'?adminRegistration:registration,{username,nickname,password});
  if(!['user','admin'].includes(role))throw new Error('Invalid role');
  const result=db.prepare('INSERT INTO users(username,nickname,password_hash,role,created_at) VALUES(?,?,?,?,?)').run(data.username,data.nickname,hashPassword(data.password),role,new Date().toISOString());
  return safeUser(db.prepare('SELECT * FROM users WHERE id=?').get(Number(result.lastInsertRowid)));
}

export function registerAuth(app,{db,now,origin,limit}) {
  const secure=new URL(origin).protocol==='https:';
  function beginSession(user,reply) {
    const token=randomBytes(32).toString('base64url');const csrfToken=randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(new Date(now()).toISOString());
    db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)').run(tokenHash(token),user.id,csrfToken,new Date(now()+7*86400000).toISOString());
    reply.setCookie('poke_session',token,{path:'/',httpOnly:true,sameSite:'lax',secure,maxAge:7*86400});
    return {user,csrfToken};
  }
  app.get('/api/v1/auth/me',async request=>({user:request.user||null,csrfToken:request.session?.csrf_token||randomBytes(32).toString('base64url')}));
  app.post('/api/v1/auth/register',async(request,reply)=>{
    const data=parse(registration,request.body);limit('register:'+request.ip,5,3600000);
    try {const user=createUser(db,data);reply.code(201);return beginSession(user,reply);}
    catch(error){if(error.code==='ERR_SQLITE_ERROR'&&error.message.includes('UNIQUE'))throw new ApiError(409,'该用户名已注册',{username:'该用户名已注册'});throw error;}
  });
  app.post('/api/v1/auth/login',async(request,reply)=>{
    const data=parse(credentials,request.body);
    limit('login-ip:'+request.ip,30,15*60000);limit('login-account:'+data.username,10,15*60000);
    const row=db.prepare('SELECT * FROM users WHERE username=?').get(data.username);
    const [salt,stored]=row?.password_hash.split(':')||['invalid-login-salt','0'.repeat(128)];
    const candidate=await asyncScrypt(data.password,salt,64);
    if(!timingSafeEqual(candidate,Buffer.from(stored,'hex'))||!row||row.disabled)throw new ApiError(401,'用户名或密码错误，或账号已停用');
    const current=db.prepare('SELECT * FROM users WHERE id=? AND disabled=0').get(row.id);
    if(!current||current.session_generation!==row.session_generation)throw new ApiError(401,'账号状态已变更，请重新登录');
    return beginSession(safeUser(current),reply);
  });
  app.post('/api/v1/auth/logout',async(request,reply)=>{
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(request.session.token_hash);
    reply.clearCookie('poke_session',{path:'/',httpOnly:true,sameSite:'lax',secure});return {ok:true};
  });
}
