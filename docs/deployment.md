# System Atlas production operations

## Components

- Static frontend: Cloudflare Pages project `country-system-atlas`.
- API: `system-atlas.service` on the VPS, bound to `127.0.0.1:3001`.
- Runtime: `/srv/system-atlas`, owned by the unprivileged `system-atlas` account.
- Database: `/srv/system-atlas/data/system-atlas.sqlite` on the VPS.
- Public API route: `system-atlas-api.eufoniadiversity.com` through the existing `parlamento` Cloudflare Tunnel.
- Automatic updates: `system-atlas-refresh.timer`.

The former `system-atlas` D1 database and `system-atlas-ingest` Worker were retired after the server cutover. A final D1 SQL export is retained locally in `data/archive/`.

## Application release

```sh
npm ci
npm run check
npm test
npm run build
npm run pages:deploy -- --project-name country-system-atlas --branch main
npm run verify:production
```

For a backend code release, run `sudo scripts/deploy-server-runtime.sh`. It synchronizes code without overwriting the independently refreshed runtime database, source archives, backups, or generated fallback files.

`.env.production` supplies the public API origin at Vite build time. A production build should contain `https://system-atlas-api.eufoniadiversity.com`; Pages itself must not expose `/api/*` Functions. Source maps are disabled and `public/_headers` applies the production CSP and browser security headers.

## First server installation

Create the runtime account, synchronize the reviewed release to `/srv`, then build and validate the initial database there:

```sh
npm run data:atlas
npm run data:audit
npm run server:db
```

Install the checked-in units, then enable the service and timer:

```sh
sudo install -m 0644 deployment/system-atlas.service /etc/systemd/system/system-atlas.service
sudo install -m 0644 deployment/system-atlas-refresh.service /etc/systemd/system/system-atlas-refresh.service
sudo install -m 0644 deployment/system-atlas-refresh.timer /etc/systemd/system/system-atlas-refresh.timer
sudo install -m 0644 deployment/system-atlas-rollback.service /etc/systemd/system/system-atlas-rollback.service
sudo install -m 0644 deployment/system-atlas-alert.service /etc/systemd/system/system-atlas-alert.service
sudo systemctl daemon-reload
sudo systemctl enable --now system-atlas.service system-atlas-refresh.timer
```

The remotely managed tunnel must route `system-atlas-api.eufoniadiversity.com` to `http://127.0.0.1:3001`, followed by the tunnel's catch-all rule. DNS is a proxied CNAME to the tunnel UUID. `/etc/system-atlas/environment` may set `SYSTEM_ATLAS_DEPLOY_PAGES=1`, Cloudflare credentials, `SYSTEM_ATLAS_R2_BUCKET`, and `SYSTEM_ATLAS_ALERT_WEBHOOK_URL`; secrets never belong in Git.

## Routine checks

```sh
systemctl status system-atlas.service system-atlas-refresh.timer
systemctl list-timers system-atlas-refresh.timer
journalctl -u system-atlas.service -n 100
journalctl -u system-atlas-refresh.service -n 100
curl https://system-atlas-api.eufoniadiversity.com/api/health
npm run verify:production
```

The public API is also checked from GitHub Actions every 30 minutes. The monitor opens an issue assigned to the repository owner when the API is unavailable, stale, degraded, incomplete, or reports a failed refresh, and closes the incident after recovery. GitHub issue notifications provide email delivery without storing SMTP credentials on the VPS. Keep GitHub email notifications enabled for assigned issues.

To exercise the full refresh manually, start the oneshot service and inspect its journal:

```sh
sudo systemctl start system-atlas-refresh.service
journalctl -u system-atlas-refresh.service -f
```

## Rollback and recovery

- `data/system-atlas.sqlite.previous` is the prior published database. A failed post-publication health check restores it automatically.
- Cloudflare Pages retains prior static deployments for frontend rollback.
- The split `public/data/atlas-index.json` plus `public/data/countries/*.json` remains the browser fallback.
- The database builder writes to a candidate file and validates it before any swap; refresh failure therefore leaves the current database and running process unchanged.
- Local compressed backups retain 14 days by default. Set `SYSTEM_ATLAS_R2_BUCKET` to upload them off-host; configure a bucket lifecycle policy for off-host retention.
