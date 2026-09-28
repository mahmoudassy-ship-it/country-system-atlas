# System Atlas

System Atlas is a public-interest country profile application. It combines an interactive world map with transparent social, economic, institutional, rights, health, education, safety, infrastructure, and environmental indicators.

## Architecture

- **Frontend:** React + Vite deployed to [country-system-atlas.pages.dev](https://country-system-atlas.pages.dev/).
- **Read API:** a small Node service on the existing VPS, exposed at [system-atlas-api.eufoniadiversity.com](https://system-atlas-api.eufoniadiversity.com/api/health) through the same private Cloudflare Tunnel pattern as Parlamento.
- **Normalized data:** a validated SQLite database on the VPS. The server opens it read-only.
- **Automated refresh:** a hardened systemd timer running as `system-atlas` archives and audits all upstream sources daily, backs up the current release, validates a candidate SQLite database, atomically swaps it, verifies the restarted API, and rolls back automatically if publication fails.
- **Current reviewed catalogue:** 87 indicators from World Bank WDI/WGI, UNDP, International IDEA, V-Dem/Our World in Data, the IMF, ILGA World, and the UN Global SDG Indicators Database. Coverage spans demographics, economic structure, work and gender subgroups, education, health, equality and inclusion, institutions, democracy, public debt and spending, rights and safety, essential services, and the planet.
- **Country/economy roster:** 217 non-aggregate World Bank reporting economies plus Taiwan and Vatican City. Every record identifies its roster basis and entity type. The combined World Bank Channel Islands entry is searchable but has no single matching map shape.

See [docs/architecture.md](docs/architecture.md) for the full data lifecycle and [docs/deployment.md](docs/deployment.md) for the one-time Cloudflare setup and release commands.

## Local development

```sh
npm install
npm run data:atlas
npm run data:audit
npm run server:db
npm run dev
```

Run `npm run server:start` for the API. The frontend uses a relative API locally unless `VITE_API_ORIGIN` is set; production uses the server origin declared in `.env.production`.

## Production

Cloudflare Pages serves only the static frontend. The API and SQLite database run under `system-atlas.service`; `system-atlas-refresh.timer` performs the daily refresh. Deployment templates are in `deployment/`.

Run `npm run verify:production` to confirm that Pages, the VPS API, the 219-profile roster, all 87 documented indicators, all nine sources, and the Egypt reference profile are reachable and internally consistent.
