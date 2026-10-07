import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

async function start(options) {
  const { app, db } = await createApp(options);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, cookie, extra = {}) => fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const close = async () => { await new Promise(resolve => server.close(resolve)); await db.close(); };
  return { request, close, db, base };
}
const sessionCookie = response => response.headers.get('set-cookie').split(';')[0];
const credentials = { email: 'person@example.com', password: 'Correct-password-123', remember: true };

test('registration, validation, login, persistence, expiry, and logout', async () => {
  const mongoUri = `mongodb://127.0.0.1:27017/linkedin_auth_test_${randomUUID().replaceAll('-', '')}`;
  let service = await start({ mongoUri });
  try {
    assert.equal((await service.request('/auth/me')).status, 401);
    assert.equal((await service.request('/auth/register', { ...credentials, email: 'invalid' })).status, 400);
    assert.equal((await service.request('/auth/register', { ...credentials, password: 'short' })).status, 400);
    assert.equal((await service.request('/auth/register', { ...credentials, remember: 'true' })).status, 400);
    const created = await service.request('/auth/register', { ...credentials, email: ' Person@Example.com ' });
    assert.equal(created.status, 201);
    assert.match(created.headers.get('set-cookie'), /HttpOnly/);
    assert.match(created.headers.get('set-cookie'), /SameSite=Lax/);
    assert.match(created.headers.get('set-cookie'), /Max-Age=2592000/);
    const data = await created.json();
    assert.equal(data.user.email, credentials.email);
    assert.deepEqual(Object.keys(data.user).sort(), ['createdAt', 'email', 'id']);
    const remembered = sessionCookie(created);
    const stored = await service.db.User.findOne().lean();
    assert.match(stored.password_hash, /^scrypt\$/);
    assert.ok(!stored.password_hash.includes(credentials.password));
    assert.notEqual((await service.db.Session.findOne().lean()).token_hash, remembered.split('=')[1]);
    assert.equal((await service.request('/auth/register', credentials)).status, 409);
    assert.equal((await service.request('/auth/login', { ...credentials, password: 'wrong-password' })).status, 401);
    assert.equal((await service.request('/auth/login', { ...credentials, email: 'missing@example.com' })).status, 401);
    await service.close();
    service = await start({ mongoUri });
    assert.equal((await service.request('/auth/me', undefined, remembered)).status, 200);
    const login = await service.request('/auth/login', { ...credentials, remember: false }, remembered);
    assert.equal(login.status, 200);
    assert.ok(!login.headers.get('set-cookie').includes('Max-Age'));
    const temporary = sessionCookie(login);
    assert.equal((await service.request('/auth/me', undefined, remembered)).status, 401);
    assert.equal((await service.request('/auth/me', undefined, temporary)).status, 200);
    assert.equal((await service.request('/auth/logout', {}, temporary)).status, 200);
    assert.equal((await service.request('/auth/me', undefined, temporary)).status, 401);
    const expiring = sessionCookie(await service.request('/auth/login', credentials));
    await service.db.Session.updateMany({}, { expires_at: new Date(Date.now() - 1) });
    assert.equal((await service.request('/auth/me', undefined, expiring)).status, 401);
  } finally {
    await dropTestDatabase(service.db);
    await service.close();
  }
});

test('request protections, CORS, secure cookies, and rate limiting', async () => {
  const service = await start({ mongoUri: `mongodb://127.0.0.1:27017/linkedin_auth_test_${randomUUID().replaceAll('-', '')}`, authLimit: 3, secureCookies: true });
  try {
    assert.equal((await service.request('/auth/register', credentials, null, { Origin: 'https://untrusted.example' })).status, 403);
    const health = await service.request('/health', undefined, null, { Origin: 'http://localhost:5173' });
    assert.equal(health.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal((await fetch(`${service.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await fetch(`${service.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    const created = await service.request('/auth/register', credentials);
    assert.equal(created.status, 201);
    assert.match(created.headers.get('set-cookie'), /Secure/);
    await service.request('/auth/login', { ...credentials, password: 'incorrect' });
    await service.request('/auth/login', { ...credentials, password: 'incorrect' });
    assert.equal((await service.request('/auth/login', credentials)).status, 429);
    assert.equal((await service.request('/unknown')).status, 404);
  } finally { await dropTestDatabase(service.db); await service.close(); }
});

async function dropTestDatabase(db) {
  if (!/^linkedin_auth_test_[a-f0-9]{32}$/.test(db.connection.name)) throw new Error('Refusing to drop a non-test database');
  await db.connection.dropDatabase();
}
