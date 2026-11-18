# Security policy

This repository is a source-code and engineering case study. It is not deployed from here; the
production website is operated separately.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/jefferRB/luxe-centro-de-belleza/security/advisories/new)
on this repository, not in public issues. Include the affected file or route, the steps to
reproduce and the expected impact.

## Scope

- The photo admin (`src/pages/admin/`, `src/server/`, `src/middleware.ts`): authentication,
  sessions, CSRF, uploads and publishing.
- The build verification and media publication policy (`scripts/verify-build.ts`,
  `src/data/media-catalog.ts`).
- The reference deployment examples in `deploy/`.

The security model, its assumptions and known trade-offs are described in
[docs/security.md](docs/security.md).

## Secrets

The repository contains no credentials. Admin credentials are generated locally with
`npm run admin:password` and only their hash is written to the git-ignored `.env.admin`. If you
believe a secret was committed, report it privately as above.
