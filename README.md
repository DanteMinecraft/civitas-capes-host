# Civitas Capes static host

Static files for hosting Civitas Capes JSON data and PNG textures with Nginx, suitable for a Dokploy Dockerfile application.

## Files
- `index.html`: service landing page
- `capes.json`: cape catalog
- `players.json`: player cape assignments
- `capes/`: put cape PNG files here
- `Dockerfile`: serves the files on port 80

## Before deploying
1. Replace `YOUR-DOMAIN` in `capes.json` with the real public hostname, e.g. `capes.teamcivitas.net`.
2. Replace `REPLACE-WITH-PLAYER-UUID` with a real Minecraft UUID (standard hyphenated UUID format).
3. Add your cape PNG at `capes/auth.png`, or change the URL to match your file.
4. Commit/push the files to a Git repository.

## Deploy in Dokploy
1. Create an Application from your Git repository.
2. Choose Dockerfile as the build type (or let Dokploy detect the included `Dockerfile`).
3. Deploy the application.
4. Add a domain in the application's Domains settings and route it to container port `80`.
5. Enable HTTPS in Dokploy.
6. Test `/`, `/capes.json`, `/players.json`, and `/capes/auth.png` over HTTPS.

The `capes/` directory is intentionally empty in this starter bundle. Add a PNG file before expecting the cape image URL to work.
