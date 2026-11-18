/** Local development only: `astro dev` reads the admin credentials from `.env.admin`
 * (git-ignored, written by `npm run admin:password -- --local`). Vite's own `.env` loading
 * is not used because it only feeds `import.meta.env` and expands `$`, which would corrupt
 * an Argon2 hash; `process.loadEnvFile` does neither and never overrides variables already
 * set in the environment. Builds, previews and production (systemd EnvironmentFile) are
 * untouched. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

export const LOCAL_ADMIN_ENV = '.env.admin';

export default function localAdminEnv(): AstroIntegration {
  return {
    name: 'luxe-local-admin-env',
    hooks: {
      'astro:config:setup': ({ command, config, logger }) => {
        if (command !== 'dev') return;
        const file = fileURLToPath(new URL(LOCAL_ADMIN_ENV, config.root));
        if (!existsSync(file)) {
          if (!process.env.LUXE_ADMIN_USER) logger.info(`Sin ${LOCAL_ADMIN_ENV}: /admin queda deshabilitado. Crealo con npm run admin:password -- --local`);
          return;
        }
        process.loadEnvFile(file);
        logger.info(`Credenciales del panel cargadas desde ${LOCAL_ADMIN_ENV}.`);
      },
    },
  };
}
