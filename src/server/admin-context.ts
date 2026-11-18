/** One store and one publisher per server process (single admin, single writer). */
import { readAdminConfig, type AdminConfig } from './config.ts';
import { MediaStore } from './media-store.ts';
import { Publisher } from './publisher.ts';

export interface AdminContext {
  readonly config: AdminConfig;
  readonly store: MediaStore;
  readonly publisher: Publisher;
}

let context: AdminContext | undefined;

export function getAdminContext(): { ok: true; context: AdminContext } | { ok: false; reason: string } {
  if (context) return { ok: true, context };
  const result = readAdminConfig();
  if (!result.ok) return result;
  const { config } = result;
  const store = new MediaStore(config.mediaDir);
  const publisher = new Publisher({
    projectRoot: config.projectRoot,
    mediaDir: config.mediaDir,
    siteDir: config.siteDir,
    currentRevision: async () => (await store.read()).revision,
    log: (message) => console.log(`[luxe-admin] ${message}`),
  });
  context = { config, store, publisher };
  return { ok: true, context };
}
