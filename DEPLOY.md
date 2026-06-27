# Mama Babi POS — Production Deployment Guide

## Architecture Overview

```
[Windows PC 1]          [Windows PC 2]          [Windows PC 3]
  Installer.exe           Installer.exe           Installer.exe
       ↓                       ↓                       ↓
  App (Electron)          App (Electron)          App (Electron)
       ↓                       ↓                       ↓
       └───────────────────────┴───────────────────────┘
                               ↓  HTTPS
                    [Fastify API — your server]
                               ↓
                    [PostgreSQL — Supabase or VPS]
```

All desktop installations are stateless — they connect to the same API and database.
No database is installed on client machines.

---

## Prerequisites

Before building the installer:

- Node.js 20+ and pnpm installed on your build machine
- API deployed and accessible over HTTPS
- PostgreSQL database seeded (`pnpm db:pg:seed`)
- An app icon in ICO format (256×256 recommended)

---

## Step 1 — Deploy the API Server

The Fastify API must be running on a server accessible from all client machines.

### Option A: VPS / Dedicated Server

```bash
# On your server
git clone <your-repo>
cd <repo>
cp .env.example .env
# Edit .env with production values

pnpm install --frozen-lockfile
pnpm --filter @mama-babi/api build   # if there is a build step
node apps/api/dist/index.js
```

Use **PM2** for production process management:

```bash
npm install -g pm2
pm2 start "npx tsx apps/api/src/index.ts" --name "mamababi-api"
pm2 startup
pm2 save
```

### Option B: Railway / Render / Fly.io (PaaS)

Set environment variables in the dashboard:
```
DATABASE_URL=postgresql://...
JWT_SECRET=<at least 32 random chars>
JWT_EXPIRES_IN=8h
CORS_ORIGIN=*
NODE_ENV=production
API_PORT=3001
RATE_LIMIT_MAX_AUTH=10
RATE_LIMIT_MAX_API=300
```

### Required: HTTPS

All client machines must connect via **HTTPS** (not HTTP) in production.
Use a reverse proxy (nginx / Caddy) with a free Let's Encrypt certificate, or
let the PaaS provider handle TLS termination.

Your final API URL will look like: `https://api.yourdomain.com`

---

## Step 2 — Prepare the Build Machine

```bash
# Clone the repository on a Windows machine (or Windows VM)
git clone <your-repo>
cd <repo>
pnpm install
```

---

## Step 3 — Configure the Installer

Edit `apps/desktop/resources/config.json` **before building**:

```json
{
  "apiUrl": "https://api.yourdomain.com",
  "environment": "production",
  "updateFeedUrl": ""
}
```

| Field | Description |
|---|---|
| `apiUrl` | Full HTTPS URL of your API server. **Required.** |
| `environment` | `"production"` or `"staging"` |
| `updateFeedUrl` | URL of your auto-update server (leave empty to disable) |

> This file is copied into the installer's `resources/` directory. Clients can
> edit it after installation at `C:\Users\<user>\AppData\Local\Programs\Mama Babi POS\resources\config.json`
> if the API URL ever changes, without needing a full reinstall.

---

## Step 4 — Add the Application Icon (Optional but Recommended)

Create a folder `apps/desktop/build-resources/` and place your icon there:

```
apps/desktop/build-resources/
  icon.ico        ← 256×256 ICO file (required for Windows)
```

Free tools: [IcoFX](https://icofx.ro) or [ConvertICO](https://convertico.com)

If no icon is provided, electron-builder will use the default Electron icon.

---

## Step 5 — Build the Installer

```bash
cd apps/desktop
pnpm dist:win
```

This runs:
1. `electron-vite build` — bundles the app (JS, CSS, assets)
2. `electron-builder --win` — packages it into an NSIS installer

The installer is output to:
```
apps/desktop/release/
  Mama Babi POS Setup 1.0.0.exe   ← distribute this file
```

**Build time:** approximately 3–8 minutes on first run (downloading Electron binaries).

---

## Step 6 — Distribute the Installer

### Manual Distribution

Share the `.exe` file via:
- USB drive
- Google Drive / OneDrive link
- Internal file server
- Email

### Silent Installation (IT deployment)

```cmd
"Mama Babi POS Setup 1.0.0.exe" /S
```

- `/S` = silent install, no UI
- Default install path: `C:\Users\<user>\AppData\Local\Programs\Mama Babi POS`
- Or per-machine: `"Mama Babi POS Setup 1.0.0.exe" /S /allusers`

---

## Step 7 — First Run Verification

After installation:
1. Launch from Desktop shortcut or Start Menu → **Mama Babi**
2. The login screen should show **"Connected to server"** (green)
3. Log in with: `admin` / `admin123` (change password immediately)
4. Go to **Settings → General** and configure store name, currency, etc.

---

## Versioning Strategy

We use **Semantic Versioning**: `MAJOR.MINOR.PATCH`

| Type | When | Example |
|---|---|---|
| PATCH | Bug fixes, small improvements | `1.0.1` |
| MINOR | New features, backward compatible | `1.1.0` |
| MAJOR | Breaking changes, DB schema changes | `2.0.0` |

**To release a new version:**

1. Update version in `apps/desktop/package.json`:
   ```json
   { "version": "1.1.0" }
   ```
2. Commit and tag: `git tag v1.1.0`
3. Build: `pnpm dist:win`
4. Distribute the new installer

---

## Upgrade Strategy

### Manual Upgrade

Distribute the new installer. The NSIS installer detects the existing installation
and upgrades it in-place. User settings and shortcuts are preserved.
The `resources/config.json` is **not overwritten** during upgrade, so API URL
configuration persists.

### Silent Upgrade

```cmd
"Mama Babi POS Setup 1.1.0.exe" /S
```

### Auto-Update (Future)

Auto-updates are architecturally ready. To enable:

1. Set up an update server (e.g., GitHub Releases or an S3 bucket)
2. Upload `release/latest.yml` and the `.exe` after each build
3. Set `updateFeedUrl` in `resources/config.json`:
   ```json
   {
     "updateFeedUrl": "https://updates.yourdomain.com/releases/"
   }
   ```
4. The app checks for updates 10 seconds after launch and every 4 hours.
   Users are prompted before downloading.

**Using GitHub Releases as update server:**
Replace `"publish": null` in `package.json` with:
```json
"publish": {
  "provider": "github",
  "owner": "your-github-username",
  "repo": "pos-releases"
}
```
Then run `pnpm dist:win` with `GH_TOKEN=<your-token>` set.

---

## Environment Variables Reference (API Server)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string with SSL |
| `JWT_SECRET` | ✅ | Min 32 chars, random, keep secret |
| `JWT_EXPIRES_IN` | ✅ | e.g. `8h` (token lifetime) |
| `NODE_ENV` | ✅ | `production` |
| `API_PORT` | ✅ | e.g. `3001` |
| `CORS_ORIGIN` | ✅ | Domain of your frontend, or `*` for any |
| `RATE_LIMIT_MAX_AUTH` | ✅ | Max login attempts per 15 min (e.g. `10`) |
| `RATE_LIMIT_MAX_API` | ✅ | Max API calls per minute (e.g. `300`) |

---

## Security Checklist

- [ ] API is served over HTTPS (not HTTP)
- [ ] `JWT_SECRET` is at least 32 random characters
- [ ] `JWT_SECRET` is not the default dev value
- [ ] Database URL is not exposed in client code (it isn't — API only)
- [ ] `config.json` only contains the API URL, not DB credentials
- [ ] Admin password changed from `admin123` after first install
- [ ] Rate limiting enabled on the API (`RATE_LIMIT_MAX_AUTH=10`)
- [ ] PostgreSQL RLS enabled (`pnpm db:pg:enable-rls`)
- [ ] Installer signed with a code-signing certificate (optional but recommended)

---

## Code-Signing the Installer (Optional)

Code-signing prevents Windows SmartScreen warnings. You need an EV or OV
code-signing certificate from a CA like Sectigo or DigiCert.

In `package.json` build config, add:
```json
"win": {
  "certificateFile": "path/to/cert.p12",
  "certificatePassword": "${env.CSC_KEY_PASSWORD}"
}
```

Or set environment variables:
```
CSC_LINK=path/to/cert.p12
CSC_KEY_PASSWORD=yourpassword
```

---

## Troubleshooting

### "Server unreachable" on login screen
- Verify the API is running: `curl https://api.yourdomain.com/api/v1/health`
- Check `resources/config.json` has the correct `apiUrl`
- Ensure the client machine can reach the server (firewall/VPN)

### "Session expired. Please log in again."
- The JWT has expired (default: 8h)
- This is normal — the user must log in again
- Increase `JWT_EXPIRES_IN` in the API's `.env` if needed

### App shows "CLOUD_API_URL not configured"
- `resources/config.json` is missing or `apiUrl` is empty
- Rebuild after editing the config file

### Printer not working after install
- Printing uses local Windows printer drivers — no additional setup needed
- Verify printer name in Settings → Printers

---

## File Structure After Installation

```
C:\Users\<user>\AppData\Local\Programs\Mama Babi POS\
  Mama Babi POS.exe          ← main executable
  resources/
    app.asar                 ← bundled app code (not user-readable)
    config.json              ← ✅ edit this to change API URL
    preload.cjs
  locales/
  ...
```

```
C:\Users\<user>\AppData\Roaming\Mama Babi POS\
  mama-babi.db               ← local SQLite (print templates, cache)
```

---

## Building for Multiple Environments

To build for staging vs production without code changes, maintain separate config files:

```
apps/desktop/resources/
  config.json                ← dev (gitignored in production workflow)
  config.production.json     ← production template
  config.staging.json        ← staging template
```

In your CI/CD pipeline:
```bash
cp apps/desktop/resources/config.production.json apps/desktop/resources/config.json
pnpm dist:win
```

---

*Generated for Mama Babi POS v1.x*
