import assert from 'node:assert/strict';
import { buildApp } from '../server/app.mjs';
import { createUser } from '../server/auth.mjs';

process.env.NODE_ENV = 'production';
const origin = 'https://intel.example.test';
const app = await buildApp({dbPath:':memory:',origin});
try {
  const page = await app.inject('/');
  assert.equal(page.statusCode,200);
  assert.match(page.headers['content-type'],/text\/html/);
  assert.match(page.body,/Poke/);
  assert.match(page.headers['content-security-policy'],/script-src 'self';/);
  assert.equal((await app.inject('/history')).statusCode,200);
  const unknown = await app.inject('/api/v1/not-found');
  assert.equal(unknown.statusCode,404);
  assert.match(unknown.headers['content-type'],/application\/json/);
  createUser(app.db,{username:'smoke',nickname:'验证账号',password:'smoke-verification-password'});
  const login = await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},payload:{username:'smoke',password:'smoke-verification-password'}});
  assert.equal(login.statusCode,200);
  const cookie=login.headers['set-cookie'];
  assert.match(cookie,/Secure/); assert.match(cookie,/HttpOnly/); assert.match(cookie,/SameSite=Lax/);
  assert.equal((await app.inject('/api/v1/status')).json().externalSourcesEnabled,false);
  console.log('生产网页、SPA 路由、API 404、安全 Cookie 与 CSP 检查通过。');
} finally { await app.close(); }
