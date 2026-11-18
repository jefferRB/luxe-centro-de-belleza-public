/** Guards every /admin request on the server. Public pages are prerendered and never pass
 * through here. Hiding buttons is not security: each private request is checked for a live
 * session, its origin and its CSRF token before any route code runs. */
import { defineMiddleware } from 'astro:middleware';
import { json, SESSION_COOKIE } from './server/http.ts';
import { csrfMatches, readSession } from './server/sessions.ts';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const SAFE_METHODS = new Set(['GET', 'HEAD']);

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";

function harden(response: Response): Response {
  const secured = new Response(response.body, response);
  const headers = secured.headers;
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (import.meta.env.PROD) {
    headers.set('Content-Security-Policy', CSP);
    headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
  return secured;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { url, request } = context;
  if (context.isPrerendered || !(url.pathname === '/admin' || url.pathname.startsWith('/admin/'))) return next();

  // Credentials only travel over HTTPS in production (nginx terminates TLS and forwards the scheme).
  if (import.meta.env.PROD && url.protocol !== 'https:' && !LOOPBACK.has(url.hostname)) {
    return harden(new Response('Se requiere HTTPS.', { status: 403 }));
  }

  const token = context.cookies.get(SESSION_COOKIE)?.value;
  const session = readSession(token);
  context.locals.admin = session && token ? { session, token } : null;

  const mutating = !SAFE_METHODS.has(request.method);
  if (mutating && request.headers.get('origin') !== url.origin) {
    return harden(json({ error: 'Origen no permitido.' }, 403));
  }

  const isApi = url.pathname.startsWith('/admin/api/');
  const isLogin = url.pathname === '/admin/api/session' && request.method === 'POST';
  if (isApi && !isLogin) {
    if (!session) return harden(json({ error: 'Tu sesión terminó. Ingresá de nuevo.' }, 401));
    if (mutating && !csrfMatches(session, request.headers.get('x-csrf-token'))) {
      return harden(json({ error: 'El token de seguridad no es válido. Recargá el panel.' }, 403));
    }
  }
  return harden(await next());
});
