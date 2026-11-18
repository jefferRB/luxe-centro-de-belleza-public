declare namespace App {
  interface Locals {
    /** Set by src/middleware.ts on /admin requests with a live session. */
    admin?: { readonly session: import('./server/sessions.ts').Session; readonly token: string } | null;
  }
}

declare module 'virtual:luxe-managed-media' {
  import type { ImageMetadata } from 'astro';
  import type { MediaManifest } from './lib/media-manifest.ts';
  /** The admin's changes, read at build time from LUXE_MEDIA_DIR/manifest.json. */
  export const manifest: MediaManifest;
  /** Uploaded photos shown on the site, keyed by their file name. */
  export const uploads: Readonly<Record<string, ImageMetadata>>;
}
