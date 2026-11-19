# Testing

| Command | What it checks |
|---|---|
| `npm run check` | `astro check`: TypeScript (strict, `noUncheckedIndexedAccess`) and Astro diagnostics |
| `npm test` | Unit tests with `node:test` (`tests/*.test.ts`) |
| `npm run build` | Static site and admin server; `postbuild` runs `scripts/verify-build.ts` |
| `npm run test:e2e` | Playwright (`tests/e2e/`) against `astro dev` on `http://localhost:4321` |
| `npm run verify:publication` | Repository gate: every image referenced by the docs exists, and production screenshots are published only with recorded authorization ([media-policy.md](media-policy.md#readme-images)) |

The CI workflow ([`.github/workflows/verify.yml`](../.github/workflows/verify.yml)) runs all of
them on Node 24. At the time of writing the suites pass locally (226 unit tests, 137 end-to-end
tests including the opt-in admin specs); the workflow has not yet run on GitHub.

## What each suite protects

### Unit (`tests/*.test.ts`)

| File | Area |
|---|---|
| `quaternion.test.ts`, `globe.test.ts`, `globe-media.test.ts` | Globe rotation, composition rules, video hysteresis and settling |
| `space-orbit.test.ts`, `space-camera.test.ts`, `orbit.test.ts` | Crown poses, the camera, ring paths, bounds; works crown; space tour; structured data |
| `showcase.test.ts`, `signature.test.ts`, `intro.test.ts` | Portfolio data and navigation state, hover intent on the specialities list, the intro gate |
| `opening-hours.test.ts`, `links.test.ts`, `drago.test.ts` | Costa Rica time, outbound link allowlist, booking URL and confirmed data |
| `media.test.ts` | Publication policy for every permission status, catalog structure, empty states of a build without approved media |
| `media-policy.test.ts` | Leak guard: every image or video in the repository must match a recorded hash (demo media, showcase captures) or be a generated icon; no archives, environment files or private folders |
| `admin-media.test.ts`, `admin-security.test.ts` | Manifest validation and changes; password hashing, strength rules, configuration, sessions, CSRF, throttling |

### Build verification (`scripts/verify-build.ts`)

Runs after every build and before every admin publish: indexable page with canonical URL and
social tags, sitemap and robots, one `h1`, required sections, outbound links only from the
confirmed allowlist, safe `target="_blank"` links, no admin files or admin configuration in the
static output, no development URLs, and the publication policy (see [media-policy.md](media-policy.md)).

### End to end (`tests/e2e/`)

| Spec | Area |
|---|---|
| `hero.spec.ts` | Intro (once, reduced motion, failing script), navigation targets, external links |
| `mundo-luxe.spec.ts` | The globe: video inside the rotor, one clip at a time, four-direction turns, drag vs click |
| `phase4.spec.ts`, `phase43.spec.ts` | Globe, works crown, space tour, visit section, dock at every width, 200 % reflow, the demo build served as static files |
| `phase4-regressions.spec.ts` | Screen-reader announcements, keyboard, hover intent, missing scripts, failing images, reduced motion mid-animation, no prices or promotions |
| `espacio-orbital.spec.ts`, `espacio-3d.spec.ts` | The orbital crown and the camera modes |
| `tactil.spec.ts` | Touch gestures and vertical scrolling |
| `admin.spec.ts` | The admin (opt-in, see below) |

## Running the end-to-end tests

```bash
npx playwright install chromium   # once
npm run dev                       # background dev server
npm run test:e2e
npx astro dev stop
```

On Windows outside CI the config uses the installed Chrome (`channel: 'chrome'`); elsewhere it
uses Playwright's Chromium. Screenshots that some specs save go to `test-results/` (git-ignored).

### Admin end-to-end tests (opt-in)

`tests/e2e/admin.spec.ts` is skipped unless these variables are set. Use **local test
credentials only**, never production ones:

```bash
npm run admin:password -- --local          # create a local test account
npx astro dev stop && npm run dev          # reload .env.admin
LUXE_E2E_ADMIN_URL=http://localhost:4321 LUXE_E2E_USER=<user> LUXE_E2E_PASSWORD=<password> npx playwright test admin
```

The suite edits the local store in `./.luxe-media/` (git-ignored) and those edits persist for the
rest of the run. Delete that folder to start again from the catalog.

## Lessons

Problems found while preparing the public version, and how they were fixed without weakening a test:

| Symptom | Cause | Fix |
|---|---|---|
| Five policy tests failed on the original code | A deployment list published photos still marked for review, bypassing each record's permission | The list was removed; only a record's own permission (`approved` or `demo`) can reach a build. The empty-state tests were kept by simulating unapproved media |
| The dock test failed at 320 px | The camera gives front cards `z-index` 31+, and the section had no stacking context, so cards painted over the fixed dock. A different page height put a scroll step on that spot | `isolation: isolate` on the space section ([`ExperienceSection.astro`](../src/components/sections/ExperienceSection.astro)) |
| Image-failure tests passed but proved nothing | They blocked requests by the original file names, which no longer exist | Patterns now target the demo files, so the failure paths run again |
| A portal test failed only in full runs | It started rapid navigation before the first photo had loaded, which is not the behaviour under test | Wait for the first photo as a precondition |
| The intro test failed intermittently | A short intro could travel most of its line before the test measured it | Sample the scissors position on every frame from the first paint |
| One admin spec broke a later spec | It saved an alt text into the shared local store | The saved text now describes the demo image, and the persistence is documented |

## Showcase images

`npm run showcase` (after `npm run build`) re-captures the README images from the local demo build
with Playwright and records their hashes in `showcase/manifest.json`, which the leak guard checks.
