# Security model

The public site is static HTML, so its attack surface is the web server configuration. The
only application code reachable over the network is the photo admin under `/admin`.

## Admin

| Concern | Implementation |
|---|---|
| Credentials | One account. Username and an Argon2id hash (PHC format; scrypt fallback on older Node) come from the server environment (`src/server/config.ts`). Missing or malformed values disable the admin; there is no default password. |
| Password setup | `npm run admin:password` asks twice without echo, enforces a strength policy and prints only the hash (`scripts/admin-password.ts`). |
| Verification | Constant-time comparison; the hash is always computed, so a wrong username costs the same time as a wrong password (`src/pages/admin/api/session.ts`). |
| Sessions | Random 256-bit token in the cookie; the server stores only its SHA-256. 30-minute idle and 8-hour absolute expiry, new token on every sign-in, real logout (`src/server/sessions.ts`). |
| Cookie | `HttpOnly`, `SameSite=Strict`, `Secure` and the `__Host-` prefix in production. |
| CSRF | Every mutating request needs the per-session token in `X-CSRF-Token` and a matching `Origin`; Astro's `checkOrigin` is also on (`src/middleware.ts`). |
| Brute force | 5 failures per address and 20 per account in 15 minutes, then a 15-minute block (`src/server/login-throttle.ts`), plus nginx request limiting. |
| Uploads | Size cap, signature sniffing (JPEG/PNG/WebP/AVIF only), decode with a pixel limit, single-frame only, minimum size, re-encode to WebP with metadata stripped, server-generated file names (`src/server/image-intake.ts`). |
| Paths | Ids and file names are validated by strict patterns; catalog files must resolve inside the project (`src/lib/media-manifest.ts`, `src/pages/admin/api/thumb/[id].ts`). |
| Input | JSON bodies capped at 32 KB with a required content type; alt text and titles reject control characters and `<` `>`. |
| Errors | Known failures map to clear messages; unexpected errors are logged server-side and return a generic `500` (`src/server/http.ts`). |
| Headers | Admin responses get CSP, `X-Frame-Options: DENY`, `nosniff`, `no-store`, `noindex` and HSTS in production. |
| Exposure | The admin is never part of the static build (checked by `scripts/verify-build.ts`); production requires HTTPS. |

## Assumptions

These hold in the reference deployment ([deploy/](../deploy/README.md)) and must hold in any other:

- The Node process listens on loopback; nginx is the only public entry point.
- nginx **replaces** `X-Forwarded-For` with the client address. Astro trusts the first value
  once the host is validated against `security.allowedDomains`, and login throttling uses it.
- Sessions and throttling are in memory: one admin process. A restart signs everyone out.

## Known trade-offs

- The per-account limit means repeated failed logins can temporarily lock the real operator
  out. This is accepted for a single-operator admin.
- The public site does not send a `script-src` policy yet: the intro gate is an inline script
  that runs before first paint and would need a hash in the policy. The nginx example sets
  `frame-ancestors`, `base-uri` and `object-src` restrictions.

## Repository hygiene

- No credentials are stored or needed: `.env.example` holds placeholders, `.env.admin` (local hash
  only) and the media store are git-ignored, and `tests/media-policy.test.ts` fails if an
  environment file, an archive or an unrecorded image appears in the tree.
- GitHub Actions run with `contents: read`, `persist-credentials: false` and pinned action
  commits.
- Dependencies are locked; `npm audit` reports no known vulnerabilities at the time of writing.
- Before publication the file tree and the Git history were scanned with Gitleaks 8.30.1 (official
  release, checksum verified) with no findings.

## Open hardening items

| Item | Status | Proposed remediation |
|---|---|---|
| Secret scanning in CI | Scanned locally before publication | Enable GitHub secret scanning and push protection, or add a pinned Gitleaks step to the workflow |
| Public `script-src` policy | Not sent | Evaluate Astro's `security.csp` (hashes for inline scripts). Inline `style` attributes set by the crowns would still need `style-src 'unsafe-inline'`; test every experience before enabling |
| Admin end-to-end tests in CI | Run locally only | A CI step that creates throwaway credentials, starts the dev server with them and runs `admin.spec.ts` |

## Reporting

See [SECURITY.md](../SECURITY.md).
