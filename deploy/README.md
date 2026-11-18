# Deployment examples

These files describe the production architecture at a generic level. Paths, domain, user
and port are placeholders: adapt them to your own server. Nothing here runs automatically.

The public site is static HTML served by nginx. The photo admin (`/admin`) runs on Node and,
when a change is saved, rebuilds and publishes the site without manual steps.

| Placeholder | Purpose |
|---|---|
| `/srv/app` | Repository checkout (code + `node_modules`), owned by a system user `app` |
| `/var/lib/app/media` | `LUXE_MEDIA_DIR`: `manifest.json`, `uploads/`, `backups/` (back this up) |
| `/var/lib/app/site` | `LUXE_SITE_DIR`: `releases/` and the `current` link that nginx serves |
| `/etc/app/admin.env` | Credentials and paths (mode `640`, readable by the service user only) |

## First installation

1. Node 24.7 or later (native Argon2id). Create a system user for the service.
2. Clone into `/srv/app`, then `npm ci` and `npm run build` (creates `dist/server`).
3. Create the media and site folders, owned by the service user.
4. Credentials: on the server, `npm run admin:password`, then copy the two printed lines into
   `/etc/app/admin.env` together with:
   ```
   LUXE_MEDIA_DIR=/var/lib/app/media
   LUXE_SITE_DIR=/var/lib/app/site
   LUXE_PROJECT_ROOT=/srv/app
   ```
   Hand the password to the operator in person or through a password manager, never by chat or email.
5. First publish, with that environment loaded: `npm run site:publish`.
6. Install `luxe-admin.service.example` as a systemd unit and enable it.
7. Adapt `nginx-luxe.conf.example` (domain, certificates, root), `nginx -t`, reload nginx.

## Updating the code

`git pull && npm ci && npm run build`, then `npm run site:publish` with the environment from
`admin.env`, and restart the service. Admin photos live outside the project and are included
in every build.

## Changing the password

`npm run admin:password`, replace `LUXE_ADMIN_PASSWORD_HASH` in `admin.env` and restart the
service (open sessions end).

## Backup and recovery

- Back up `LUXE_MEDIA_DIR` regularly (for example a daily `tar` copy kept off the server).
- Every change keeps the previous manifest in `media/backups/`. To roll back, copy a backup over
  `media/manifest.json` and run `npm run site:publish`.
- Uploaded photos are never overwritten or deleted: retiring or replacing only changes the manifest.
- If a publish fails, the previous release stays online and the admin offers a retry.

## Assumptions the security model relies on

- The Node process listens on loopback only; nginx is the single public entry point.
- nginx **replaces** `X-Forwarded-For` with `$remote_addr` (login throttling trusts its first value).
- `astro.config.mjs` lists the canonical host in `security.allowedDomains`; change it to your domain.
