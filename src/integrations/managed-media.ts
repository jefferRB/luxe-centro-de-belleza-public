/** Brings the admin's photos into the static build. The manifest and the uploads live in
 * LUXE_MEDIA_DIR, outside the repository and the published folder; this integration exposes
 * them as `virtual:luxe-managed-media`, importing each upload so it goes through the same
 * astro:assets pipeline (AVIF/WebP, srcset, dimensions) as the curated photos. */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import type { Plugin, ViteDevServer } from 'vite';
import { activeUploads, emptyManifest, parseManifest } from '../lib/media-manifest.ts';

const VIRTUAL_ID = 'virtual:luxe-managed-media';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** LUXE_MEDIA_DIR, or `.luxe-media` in the project for local work (git-ignored). */
export function resolveMediaDir(root: string): string {
  return resolve(process.env.LUXE_MEDIA_DIR?.trim() || join(root, '.luxe-media'));
}

function moduleSource(dir: string): string {
  const file = join(dir, 'manifest.json');
  const manifest = existsSync(file) ? parseManifest(JSON.parse(readFileSync(file, 'utf8'))) : emptyManifest();
  const refs = activeUploads(manifest);
  const imports = refs.map((ref, index) => `import upload${index} from ${JSON.stringify(join(dir, 'uploads', ref.file).replaceAll('\\', '/'))};`);
  const uploads = refs.map((ref, index) => `${JSON.stringify(ref.file)}: upload${index}`);
  return `${imports.join('\n')}\nexport const manifest = ${JSON.stringify(manifest)};\nexport const uploads = { ${uploads.join(', ')} };\n`;
}

function invalidate(server: ViteDevServer) {
  const environments = Object.values(server.environments ?? {});
  for (const graph of [server.moduleGraph, ...environments.map((environment) => environment.moduleGraph)]) {
    const module = graph?.getModuleById(RESOLVED_ID);
    if (module) graph.invalidateModule(module as never);
  }
}

function plugin(dir: string): Plugin {
  const manifestFile = join(dir, 'manifest.json');
  return {
    name: 'luxe-managed-media',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      this.addWatchFile(manifestFile);
      return moduleSource(dir);
    },
    // Local preview: a save in the admin shows on the next page load, without restarting.
    configureServer(server) {
      server.watcher.add(manifestFile);
      const onChange = (path: string) => { if (resolve(path) === manifestFile) invalidate(server); };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
    },
  };
}

export default function managedMedia(): AstroIntegration {
  return {
    name: 'luxe-managed-media',
    hooks: {
      'astro:config:setup': ({ config, updateConfig }) => {
        const root = fileURLToPath(config.root);
        const dir = resolveMediaDir(root);
        updateConfig({ vite: { plugins: [plugin(dir)], server: { fs: { allow: [root, dir] } } } });
      },
    },
  };
}
