# Civitas Capes Host — admin edition

A small Node.js web service with:
- Public read-only endpoints: `/capes.json`, `/players.json`, `/capes/<filename>.png`
- Admin UI: `/admin`
- Password-protected editing of the JSON files without Git commits or redeployment
- Validation before saving and atomic file writes
- Persistent data directory (`/data`) for Dokploy deployments

## Before deployment
1. Edit `data/capes.json`: replace `YOUR-DOMAIN` with your public hostname.
2. Edit `data/players.json`: replace the sample UUID with a real UUID.
3. Add your cape PNG files to `data/capes/`.
4. Push the project to your Git repository.

## Deploy in Dokploy
Create an Application from this repository and use the included Dockerfile.
- Domain/container port: **3000**
- Do not publish port 3000 directly; route it through Dokploy's proxy.
- Add environment variables:
  - `ADMIN_PASSWORD`: a strong unique password, at least 16 characters
  - `COOKIE_SECRET`: a random secret at least 32 characters long (for example output from `openssl rand -hex 32`)
- Enable HTTPS for the public domain.
- Configure persistent storage/volume so the host directory `/data` persists across redeployments. Without a persistent volume, edits may be lost on a future deployment.
- Do not set `DATA_DIR` unless you have a reason; default is `/data`.

The included `docker-compose.yml` demonstrates the persistent volume mount. If using Dokploy's Docker Compose deployment, it can be used directly; set the two environment variables in Dokploy. For a Dockerfile-based app, configure a persistent volume mounted at `/data`.

## URLs after deployment
- `/` — public landing page
- `/admin` — password-protected JSON editor
- `/capes.json` — public cape catalog
- `/players.json` — public player assignments
- `/capes/auth.png` — example cape texture path

## Important security notes
- Use HTTPS.
- Keep the admin password private and use a strong unique password.
- Public JSON files and texture URLs are intentionally readable by anyone.
- `capeForced` only affects compatible clients; this client-side mod cannot enforce server-side restrictions against modified clients.
- This starter provides editing for JSON files, not image uploads through the admin UI. To add or replace PNGs, upload them to the persistent `/data/capes` directory using your hosting/file-management method.
