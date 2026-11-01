# Civitas Capes v2 — split public API and private admin

## Architecture
One Node service, two hostnames, strict host-based routing:
- `PUBLIC_HOST` (default `capedatabase.teamcivitas.net`): read-only `GET /capes.json`, `GET /players.json`, `GET /capes/<image>`, `GET /health`.
- `ADMIN_HOST` (default `capeadmin.teamcivitas.net`): password-protected admin UI and write API.
- Both read/write the same persistent `/data` directory.

The admin UI password is an additional application login. Protect the entire admin hostname with Cloudflare Access and allow only explicitly invited email addresses. Do not rely on an obscure URL.

## Required environment variables
- `ADMIN_PASSWORD`: strong unique password, at least 16 characters.
- `COOKIE_SECRET`: random secret, at least 32 characters. Generate with `openssl rand -hex 32`.
- `PUBLIC_HOST=capedatabase.teamcivitas.net`
- `ADMIN_HOST=capeadmin.teamcivitas.net`
- `PORT=3000`
- `DATA_DIR=/data`

## Dokploy deployment
1. Deploy this repository as a Docker app/service and expose container port **3000**.
2. Add the two domains to the same app/service, both targeting port 3000:
   - `capedatabase.teamcivitas.net`
   - `capeadmin.teamcivitas.net`
3. Add a persistent volume mounted at **`/data`**. Keep using the existing volume that currently contains `capes.json`, `players.json` and `capes/`. Do not create a fresh empty volume if you need to preserve current data.
4. Set the environment variables above.
5. Deploy. The service identifies which routes to expose based on the request Host header.
6. Configure Cloudflare Access application for `capeadmin.teamcivitas.net` (include all paths) and create an allow policy for only your email and invited administrators. Use the Access dashboard's current UI. Keep `capedatabase.teamcivitas.net` outside that Access application.
7. Test:
   - `https://capedatabase.teamcivitas.net/health` => `{"ok":true}`
   - `https://capedatabase.teamcivitas.net/capes.json` => public catalog
   - `https://capedatabase.teamcivitas.net/capes/auth.png` => image
   - `https://capeadmin.teamcivitas.net/` => Cloudflare Access login, then app password login.

## Preserve current database before deploying
Before changing the running app, make a backup of the existing persistent data volume:
- Copy `/data/capes.json`, `/data/players.json`, and all `/data/capes/` files.
- Do not overwrite existing data with the empty sample `data/` directory in this repository.
- The sample `data/` directory is for local development only; it is excluded from the Docker image.

## Uploading a cape
1. Open the admin hostname and sign in.
2. In Cape Manager choose an image (PNG/JPG/WEBP, max 5 MB).
3. Enter a simple filename such as `earthbound.png` and upload.
4. Add a cape entry to the catalog JSON, e.g.
   `{ "id":"earthbound", "displayName":"Earthbound", "type":"URL", "location":"https://capedatabase.teamcivitas.net/capes/earthbound.png" }`
5. Save the catalog. Add the ID to players' `unlockedCapes` and set `activeCape` as desired.

## Important notes
- Minecraft clients continue to use the same public URLs. No mod update is needed just for this split.
- Public player JSON exposes player UUIDs and cape assignments; this is expected by the current mod design.
- The admin panel currently uses one shared app password. Cloudflare Access provides the individual invited-email allowlist. Share the app password only with trusted admins. Individual app accounts and audit logging are not included in this initial build.
- Back up `/data` regularly.
