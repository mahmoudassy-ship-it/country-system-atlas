# System Atlas architecture

## Product boundary

The product presents measurements and their provenance; it does not assign an overall country score. Context variables are separated from evaluative indicators, and every observation retains its own period, status, and source URL.

## Runtime topology

```text
Official source APIs
        │
        ▼
VPS systemd refresh job
        │ fetch, archive, normalize, and independently audit
        ▼
Candidate SQLite database
        │ integrity/count gates, then atomic file swap
        ▼
Read-only Node API on 127.0.0.1:3001 (unprivileged system-atlas user)
        │
        ▼
Cloudflare Tunnel → system-atlas-api.eufoniadiversity.com
        │
        ▼
Static React/Vite frontend on country-system-atlas.pages.dev
```

Cloudflare Pages contains no Functions or database bindings. It serves the static application only. The public API hostname is routed through the existing remotely managed tunnel used by Parlamento, so the Node process stays bound to localhost and no VPS application port is exposed publicly.

## SQLite read model

`data/system-atlas.sqlite` contains:

- dataset generation and source-update metadata;
- the seven-source registry;
- all 87 indicator definitions, interpretations, caveats, units, and links;
- 219 country/economy profiles and their latest values;
- normalized country-indicator-period observations with status and source URL.

The API opens this file with `readOnly: true` and `PRAGMA query_only = ON`. At startup it prepares the country lookup and serializes the map-ready country and indicator responses once. Observation records retain status plus published uncertainty where the source exposes it. The published database currently contains 142,972 observations.

## Refresh lifecycle

`system-atlas-refresh.timer` runs daily at 04:30 UTC with up to ten minutes of randomized delay:

1. Create a compressed local backup and upload the checksum-manifested set to private R2 storage.
2. Fetch the World Bank WDI/WGI, UNDP, International IDEA, V-Dem/Our World in Data, and IMF datasets.
3. Build the 219-profile, 87-indicator source snapshot.
4. Compare every transformed value with the exact archived source inputs and run roster, identifier, range, chronology, status, uncertainty, provenance, documentation, and map-matching checks.
5. Stop immediately if a critical or high-severity validation fails.
6. Build a new SQLite file beside the active database.
7. Require `PRAGMA integrity_check = ok` and exact 219/87/9 counts.
8. Move the previous database to `data/system-atlas.sqlite.previous`, atomically rename the candidate into place, restart the API, and require a passing local health check; post-publication verification failure triggers automatic rollback.
9. Deploy a new Pages fallback only when the content checksum changes, then prune source archives and local backups according to retention policy.

The active database is never modified in place. A failed fetch, audit, or build leaves the last successful API database untouched.

## API surface

- `GET /api/health` — database mode, exact counts, generation time, per-run status, age/freshness, degraded state, and checksums.
- `GET /api/countries` — map-ready profiles and latest available values.
- `GET /api/countries/:iso3` — one complete profile with histories plus the indicator catalogue.
- `GET /api/indicators` — definitions, scales, caveats, and source links.

All endpoints are public, read-only, and return permissive CORS headers because the data are intended for public reuse. `HEAD` and `OPTIONS` are supported. The frontend fallback is split into a compact map/catalogue index and one profile file per country, avoiding a 22 MB initial fallback download.

## Roster and time policy

The interface deliberately says country/economy. The roster is the non-aggregate World Bank API roster plus Taiwan and Vatican City, with each record carrying its inclusion basis and entity type. It is not presented as a list of 219 sovereign UN members. Every map and peer value exposes its own observation year; mixed-year comparisons are labelled, and observations older than ten years are flagged.

## Source policy

Every adapter must define stable identifiers, authoritative homepage and methodology links, reuse terms, expected update cadence, country-code mapping, reported/estimated/modelled status, validation thresholds, and comparability limitations. Sources with credentials or restrictive republication terms are not enabled until access and licensing are confirmed.
