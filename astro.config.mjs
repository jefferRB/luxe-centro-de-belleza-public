// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import managedMedia from './src/integrations/managed-media.ts';
import localAdminEnv from './src/integrations/local-admin-env.ts';

// https://astro.build/config
// The public site stays prerendered (static HTML served by nginx). Only /admin runs on the
// Node server, to manage photos; publishing rebuilds the static site (src/server/publisher.ts).
export default defineConfig({
  site: 'https://www.luxecentrobelleza.com',
  output: 'static',
  // Photos up to 15 MB plus form fields.
  adapter: node({ mode: 'standalone', bodySizeLimit: 16 * 1024 * 1024 }),
  integrations: [localAdminEnv(), managedMedia()],
  security: {
    checkOrigin: true,
    // Behind nginx: trust X-Forwarded-Proto/Host/For only for the canonical host.
    allowedDomains: [{ hostname: 'www.luxecentrobelleza.com', protocol: 'https' }],
  },
  devToolbar: { enabled: false },
  server: { host: 'localhost', port: 4321 },
  vite: { server: { strictPort: true } },
});
