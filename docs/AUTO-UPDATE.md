# Auto-Updates (GitHub Releases)

Mama Babi POS uses **electron-updater** with **GitHub Releases** as the update provider. Packaged Windows installs check for updates on startup, download in the background, then prompt the user to restart.

---

## How it works

1. On launch (packaged app only), the main process waits **10 seconds**, then calls `autoUpdater.checkForUpdates()`.
2. `electron-updater` reads `app-update.yml` (generated at build time) and queries GitHub Releases for a newer version.
3. If an update exists, it **downloads automatically** in the background.
4. Progress is sent to the React UI (`UpdateNotifier` banner).
5. When the download finishes, a **native dialog** asks the user to restart; the banner also shows a **Restart** button.
6. On restart, NSIS applies the update in place — users do not run the installer manually.

Checks repeat every **4 hours** while the app is open.

> Updates only work in **packaged** builds (`app.isPackaged`). `pnpm dev` does not check for updates.

---

## Files involved

| File | Role |
|------|------|
| `apps/desktop/package.json` | `build.publish` → GitHub provider; `dist:publish` script |
| `apps/desktop/src/main/updater/autoUpdater.ts` | Update check, download, events, restart prompt |
| `apps/desktop/src/main/ipc/updater.ts` | IPC: manual check + install |
| `apps/desktop/src/main/index.ts` | Calls `initAutoUpdater()` after window creation |
| `apps/desktop/src/main/runtimePaths.ts` | Stores `config.json` / `secrets.json` in userData so updates do not overwrite them |
| `apps/desktop/src/preload/index.ts` | Exposes `window.electron.updater` (dev) |
| `apps/desktop/resources/preload.cjs` | Same API for production preload |
| `apps/desktop/src/renderer/components/UpdateNotifier.tsx` | Download progress + restart UI |
| `apps/desktop/src/shared/update.ts` | Shared update status types |

---

## GitHub Release requirements

electron-builder expects:

| Asset | Required |
|-------|----------|
| `latest.yml` | **Yes** — update metadata (auto-uploaded by `dist:publish`) |
| `Mama Babi POS Setup X.Y.Z.exe` | **Yes** — NSIS installer |
| Git tag | `vX.Y.Z` (electron-builder default) |

**Version** must match `apps/desktop/package.json` → `"version": "X.Y.Z"`.

Release tag examples: `v0.1.0`, `v0.2.0`, `v1.0.0`

The GitHub repo configured in `package.json`:

```json
"publish": {
  "provider": "github",
  "owner": "Syed-AliH",
  "repo": "POS"
}
```

Change `owner` / `repo` if you move the repository.

---

## Preserving user data after updates

These are **not** lost on update:

| Data | Location |
|------|----------|
| Login session | JWT in memory + cloud auth |
| Printer / device settings | Merged local settings in SQLite userData |
| `config.json` | `%APPDATA%/Mama Babi POS/runtime/config.json` (migrated on first run) |
| `secrets.json` | `%APPDATA%/Mama Babi POS/runtime/secrets.json` |
| SQLite (local mode) | `%APPDATA%/Mama Babi POS/mama-babi.db` |
| Backups | `%APPDATA%/Mama Babi POS/backups/` |

On first packaged launch, bundled `config.json` and `secrets.json` are copied into `userData/runtime/` if missing.

---

## Step-by-step: publish a new release

### 1. Make and test your code changes

```bash
pnpm dev
# test checkout, products, printing, etc.
```

### 2. Bump the version

Edit `apps/desktop/package.json`:

```json
"version": "0.2.0"
```

Use [semver](https://semver.org/): `MAJOR.MINOR.PATCH`.

### 3. Build the API bundle (included in dist scripts)

```bash
pnpm build:api
```

### 4. Prepare secrets for the installer (your machine only)

Ensure `apps/desktop/resources/secrets.json` exists (from `secrets.example.json`).  
This is baked into the installer for **new** installs only; existing users keep their userData copy.

### 5. Create a GitHub personal access token

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens**
2. Create a token with **`repo`** scope (for uploading releases)
3. Set it in your shell (never commit this):

```powershell
$env:GH_TOKEN = "ghp_xxxxxxxxxxxx"
```

### 6. Build and publish to GitHub Releases

From repo root:

```bash
cd apps/desktop
pnpm dist:publish
```

Or from root:

```bash
pnpm --filter @mama-babi/desktop dist:publish
```

This will:

1. Bundle the Fastify API into `api-bundle/`
2. Build Electron (main + renderer + preload)
3. Create the NSIS installer
4. Generate `latest.yml`
5. Create GitHub Release `v0.2.0` and upload assets

### 7. Verify the release on GitHub

Open: `https://github.com/Syed-AliH/POS/releases`

Confirm:

- Tag: `v0.2.0`
- Assets: `latest.yml` + `Mama Babi POS Setup 0.2.0.exe`

### 8. Users receive the update

Users on **v0.1.0** (or any older packaged build with auto-update code):

1. Open the app
2. After ~10 seconds, update downloads in background
3. Dialog: “Restart to update?”
4. Restart → running v0.2.0

**First-time deployment** still requires distributing the installer once. All later versions are automatic.

---

## Local build without publishing

Build installer only (no GitHub upload):

```bash
cd apps/desktop
pnpm dist:win
```

Output: `C:\Temp\mamababi-build\` (configured in `package.json` → `build.directories.output`).

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No update detected | Ensure release tag matches `v{version}` and `latest.yml` is attached |
| `GH_TOKEN` error on publish | Export token with `repo` scope before `dist:publish` |
| Update works in dev but not prod | Production uses `resources/preload.cjs` — keep in sync with `src/preload/index.ts` |
| Users prompted but install fails | Ensure NSIS install path unchanged; avoid renaming `productName` |
| Private repo | Releases must be **public** for clients to download without a token, or configure a generic provider with auth |

---

## Optional: GitHub Actions

Example workflow trigger on tag push:

```yaml
on:
  push:
    tags:
      - 'v*'
jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install
      - run: pnpm build:api
      - run: pnpm --filter @mama-babi/desktop dist:publish
        env:
          GH_TOKEN: ${{ secrets.GH_TOKEN }}
```

Store `GH_TOKEN` in repository **Secrets**.
