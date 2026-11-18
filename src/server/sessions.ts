/** Server-side sessions for the single admin. The cookie carries only a random token; the
 * server keeps its hash, so logging out (or a restart) really ends the session. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_MAX_MS = 8 * 60 * 60 * 1000;
const MAX_SESSIONS = 8;

export interface Session {
  readonly csrf: string;
  readonly createdAt: number;
  lastSeen: number;
}

const sessions = new Map<string, Session>();
const digest = (token: string) => createHash('sha256').update(token).digest('base64url');

export function createSession(now = Date.now()): { token: string; session: Session } {
  for (const [key, session] of sessions) if (expired(session, now)) sessions.delete(key);
  // A single admin: the oldest sessions give way instead of growing without bound.
  while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
  const token = randomBytes(32).toString('base64url');
  const session: Session = { csrf: randomBytes(32).toString('base64url'), createdAt: now, lastSeen: now };
  sessions.set(digest(token), session);
  return { token, session };
}

const expired = (session: Session, now: number) => now - session.lastSeen > SESSION_IDLE_MS || now - session.createdAt > SESSION_MAX_MS;

/** The live session for a cookie token (sliding idle expiry), or undefined. */
export function readSession(token: string | undefined, now = Date.now()): Session | undefined {
  if (!token || token.length > 128) return undefined;
  const key = digest(token);
  const session = sessions.get(key);
  if (!session) return undefined;
  if (expired(session, now)) { sessions.delete(key); return undefined; }
  session.lastSeen = now;
  return session;
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(digest(token));
}

/** Ends every session (after a password change the server restarts, which does the same). */
export function destroyAllSessions(): void { sessions.clear(); }

export function csrfMatches(session: Session, provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(session.csrf);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
