import type { APIRoute } from 'astro';
import { createHash, timingSafeEqual } from 'node:crypto';
import { adminContext, handle, HttpError, json, readJson, SESSION_COOKIE, sessionToken } from '../../../server/http.ts';
import { loginThrottle } from '../../../server/login-throttle.ts';
import { verifyPassword } from '../../../server/password.ts';
import { createSession, destroySession, SESSION_MAX_MS } from '../../../server/sessions.ts';

export const prerender = false;

const sameText = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

/** Sign in: one account, credentials from the server environment. */
export const POST: APIRoute = (context) => handle(async () => {
  const { config } = adminContext();
  const address = context.clientAddress;
  const wait = loginThrottle.retryAfter(address);
  if (wait) return json({ error: `Demasiados intentos. Esperá ${Math.ceil(wait / 60)} minutos antes de volver a intentar.` }, 429, { 'Retry-After': String(wait) });
  const body = await readJson(context.request);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password || username.length > 64 || password.length > 256) throw new HttpError(400, 'Escribí tu usuario y tu contraseña.');
  // The hash is always checked, so a wrong user costs the same time as a wrong password.
  const passwordOk = await verifyPassword(password, config.passwordHash);
  if (!(sameText(username, config.username) && passwordOk)) {
    loginThrottle.fail(address);
    return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
  }
  loginThrottle.succeed(address);
  // A new token on every sign-in (no fixation); the previous cookie session ends.
  destroySession(sessionToken(context));
  const { token, session } = createSession();
  context.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: import.meta.env.PROD, sameSite: 'strict', path: '/', maxAge: SESSION_MAX_MS / 1000,
  });
  return json({ ok: true, csrf: session.csrf });
});

/** Sign out: the server forgets the session, then the cookie is cleared. */
export const DELETE: APIRoute = (context) => handle(async () => {
  destroySession(context.locals.admin?.token);
  context.cookies.delete(SESSION_COOKIE, { path: '/', secure: import.meta.env.PROD, httpOnly: true, sameSite: 'strict' });
  return new Response(null, { status: 204 });
});
