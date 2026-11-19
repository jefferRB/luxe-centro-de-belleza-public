# Licensing notice

This repository contains material with different owners and terms. The [MIT License](LICENSE)
covers only what is listed as such below.

| Material | Owner | Terms |
|---|---|---|
| **Source code**: `src/`, `scripts/`, `tests/`, configuration files, `deploy/` examples and the documentation in `docs/` and the READMEs | Jefferson Rojas Brizuela | [MIT](LICENSE) |
| **Generated demonstration media**: `src/assets/demo/`, `public/favicon.svg` and the icons and social image generated from it, and the demo-build captures `showcase/*.webp` | Jefferson Rojas Brizuela | [MIT](LICENSE), with the limits below |
| **Screenshots and recordings of the production site**: `showcase/production/` | LUXE Centro de Belleza and the people depicted | **Not licensed.** Published only with the business's written authorization, recorded in `showcase/production.json`. Shown solely to document this project; they may not be reused. |
| **LUXE Centro de Belleza identity**: the name, logo, trade dress, slogans used as branding, and business information such as its location, opening hours and contact channels | The business | Not licensed. Included only to document the real project accurately. |
| **The studio's original photographs, videos and client work** (as files) | The business and the people depicted | Not included in the application code and not licensed. They appear only inside the production screenshots above. |
| **Third-party names and trademarks**: Drago, WhatsApp, Instagram, Waze, Google Maps and others | Their respective owners | Not licensed. Named only to describe integrations; the icons in `src/components/ui/Icon.astro` are original line drawings that refer to these services. |
| **Dependencies** installed by `npm ci` | Their authors | Their own licenses (see each package). Not redistributed here. |

## Generated demonstration media

The images, video loops and icons listed above were produced by
[`scripts/generate-demo-media.ts`](scripts/generate-demo-media.ts),
[`scripts/generate-favicons.ts`](scripts/generate-favicons.ts),
[`scripts/generate-og-image.ts`](scripts/generate-og-image.ts) and
[`scripts/capture-showcase.ts`](scripts/capture-showcase.ts). They are vector illustrations drawn
in code and screenshots of the local demo build. They contain no photography, no client imagery,
no logo and no third-party artwork; their hashes are recorded in `src/assets/demo/manifest.json`
and `showcase/manifest.json` (see [docs/media-policy.md](docs/media-policy.md)).

The demo-build captures in `showcase/*.webp` show the site's interface, which includes the
business name *LUXE* and its Spanish interface copy. The MIT License applies to those captures
as images; it grants no right to use the LUXE name or identity, for example to present another
business as LUXE.

## Using this project

You may reuse the code under the MIT License. If you build your own site from it, replace the
business configuration in `src/data/` and every reference to the LUXE name and identity, and use
media you have the right to publish.
