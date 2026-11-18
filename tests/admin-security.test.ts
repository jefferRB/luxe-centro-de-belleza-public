import assert from 'node:assert/strict';
import test from 'node:test';
import { readAdminConfig } from '../src/server/config.ts';
import { LoginThrottle, PER_ADDRESS, PER_ACCOUNT, WINDOW_MS } from '../src/server/login-throttle.ts';
import { hashPassword, passwordProblems, verifyPassword } from '../src/server/password.ts';
import { createSession, csrfMatches, destroySession, readSession, SESSION_IDLE_MS, SESSION_MAX_MS } from '../src/server/sessions.ts';

test('password: Argon2id PHC hash, constant-time verification, malformed hashes fail', async () => {
  const hash = await hashPassword('Vela-Dorada-Esmeralda-27');
  assert.match(hash, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(await verifyPassword('Vela-Dorada-Esmeralda-27', hash), true);
  assert.equal(await verifyPassword('vela-dorada-esmeralda-27', hash), false);
  assert.equal(await verifyPassword('Vela-Dorada-Esmeralda-27', '$argon2id$v=19$m=65536,t=3,p=1$short$short'), false);
  assert.equal(await verifyPassword('x', 'texto-plano'), false);
  assert.notEqual(await hashPassword('Vela-Dorada-Esmeralda-27'), hash, 'Random salt per hash');
});

test('password strength rules reject weak or obvious passwords', () => {
  assert.ok(passwordProblems('corta').length);
  assert.ok(passwordProblems('luxeluxeluxe2026!A', 'operadora').length);
  assert.ok(passwordProblems('Operadora-Esmeralda-27', 'operadora').length);
  assert.deepEqual(passwordProblems('Vela-Dorada-Esmeralda-27', 'operadora'), []);
});

test('config: no credentials, no admin; plain-text passwords are refused', () => {
  assert.equal(readAdminConfig({}, false).ok, false);
  assert.equal(readAdminConfig({ LUXE_ADMIN_USER: 'operadora', LUXE_ADMIN_PASSWORD_HASH: 'MiClave123' }, false).ok, false);
  const production = readAdminConfig({ LUXE_ADMIN_USER: 'operadora', LUXE_ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=1$a$b' }, true);
  assert.equal(production.ok, false, 'Production requires an explicit LUXE_MEDIA_DIR');
  const ok = readAdminConfig({ LUXE_ADMIN_USER: 'operadora', LUXE_ADMIN_PASSWORD_HASH: '$argon2id$v=19$m=65536,t=3,p=1$a$b', LUXE_MEDIA_DIR: '/var/lib/example/media' }, true);
  assert.equal(ok.ok, true);
});

test('sessions: random tokens, sliding idle expiry, absolute limit and real logout', () => {
  const start = 1_000_000;
  const { token, session } = createSession(start);
  assert.ok(token.length >= 43);
  assert.equal(readSession(token, start + 1000), session);
  assert.equal(readSession(token + 'x', start + 1000), undefined);
  assert.ok(csrfMatches(session, session.csrf));
  assert.ok(!csrfMatches(session, 'otro'));
  assert.ok(!csrfMatches(session, null));
  // Sliding: activity keeps it alive up to the absolute maximum.
  let now = start;
  while (now + SESSION_IDLE_MS / 2 < start + SESSION_MAX_MS) { now += SESSION_IDLE_MS / 2; assert.ok(readSession(token, now)); }
  assert.equal(readSession(token, start + SESSION_MAX_MS + 1), undefined);
  const idle = createSession(start);
  assert.equal(readSession(idle.token, start + SESSION_IDLE_MS + 1), undefined);
  const live = createSession(start);
  destroySession(live.token);
  assert.equal(readSession(live.token, start + 1), undefined);
});

test('login throttle: per address and for the whole account', () => {
  const throttle = new LoginThrottle();
  const now = 5_000_000;
  for (let attempt = 0; attempt < PER_ADDRESS - 1; attempt++) throttle.fail('1.1.1.1', now);
  assert.equal(throttle.retryAfter('1.1.1.1', now), 0);
  throttle.fail('1.1.1.1', now);
  assert.ok(throttle.retryAfter('1.1.1.1', now) > 0);
  assert.equal(throttle.retryAfter('2.2.2.2', now), 0, 'Other addresses still allowed');
  assert.equal(throttle.retryAfter('1.1.1.1', now + WINDOW_MS + 1), 0, 'Block expires');

  const account = new LoginThrottle();
  for (let attempt = 0; attempt < PER_ACCOUNT; attempt++) account.fail(`10.0.0.${attempt}`, now);
  assert.ok(account.retryAfter('10.9.9.9', now) > 0, 'Rotating addresses does not help');
});
