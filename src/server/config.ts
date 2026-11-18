/** Admin runtime configuration, read from the server environment at request time (never
 * inlined in client bundles). Missing credentials disable the admin instead of falling
 * back to a default password. */
import { resolve } from 'node:path';
import { resolveMediaDir } from '../integrations/managed-media.ts';

export interface AdminConfig {
  readonly username: string;
  readonly passwordHash: string;
  /** Persistent store: manifest, uploads, backups, thumbnails (LUXE_MEDIA_DIR). */
  readonly mediaDir: string;
  /** Repository checkout used to rebuild the public site (LUXE_PROJECT_ROOT or cwd). */
  readonly projectRoot: string;
  /** Where published releases live; nginx serves `<siteDir>/current`. Unset: local preview only. */
  readonly siteDir?: string;
  readonly production: boolean;
}

export type ConfigResult = { readonly ok: true; readonly config: AdminConfig } | { readonly ok: false; readonly reason: string };

export function readAdminConfig(env: NodeJS.ProcessEnv = process.env, production = import.meta.env.PROD): ConfigResult {
  const username = env.LUXE_ADMIN_USER?.trim();
  const passwordHash = env.LUXE_ADMIN_PASSWORD_HASH?.trim();
  if (!username || !passwordHash) return { ok: false, reason: 'Faltan LUXE_ADMIN_USER y LUXE_ADMIN_PASSWORD_HASH en el entorno del servidor.' };
  if (!/^\$(argon2id|scrypt)\$/.test(passwordHash)) return { ok: false, reason: 'LUXE_ADMIN_PASSWORD_HASH no es un hash válido (generalo con npm run admin:password).' };
  const projectRoot = resolve(env.LUXE_PROJECT_ROOT?.trim() || process.cwd());
  const siteDir = env.LUXE_SITE_DIR?.trim();
  if (production && !env.LUXE_MEDIA_DIR?.trim()) return { ok: false, reason: 'Falta LUXE_MEDIA_DIR: las fotografías deben guardarse fuera del proyecto.' };
  return {
    ok: true,
    config: { username, passwordHash, mediaDir: resolveMediaDir(projectRoot), projectRoot, ...(siteDir && { siteDir: resolve(siteDir) }), production },
  };
}
