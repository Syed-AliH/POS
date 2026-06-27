# Mama Babi POS

Offline-capable Point of Sale system for **Mama Babi** baby products retail. The desktop app runs on Windows (Electron), with optional cloud-backed storage so multiple registers share one database.

---

## Tech stack

| Layer | Technologies |
|-------|----------------|
| **Desktop shell** | [Electron](https://www.electronjs.org/) 35, [electron-vite](https://electron-vite.org/), [electron-builder](https://www.electron.build/) (Windows NSIS installer) |
| **Frontend** | [React](https://react.dev/) 19, [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/), [React Router](https://reactrouter.com/) |
| **UI & styling** | [Tailwind CSS](https://tailwindcss.com/), [Lucide](https://lucide.dev/) icons, shared `@mama-babi/ui` components |
| **Client state** | [Zustand](https://zustand.docs.pmnd.rs/) |
| **API server** | [Fastify](https://fastify.dev/) 5, [Zod](https://zod.dev/) validation, [@fastify/jwt](https://github.com/fastify/fastify-jwt), CORS, rate limiting |
| **Databases** | **PostgreSQL** (cloud / production via [Drizzle ORM](https://orm.drizzle.team/)), **SQLite** ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)) for local-only dev |
| **Auth** | bcrypt password hashing, JWT sessions (`JWT_EXPIRES_IN` configurable, default `never`) |
| **Printing** | ESC/POS receipts, label printers (TSPL/raster), `electron-pos-printer`, custom label renderer |
| **Import / export** | [SheetJS (xlsx)](https://sheetjs.com/) for Excel product import |
| **Monorepo** | [pnpm](https://pnpm.io/) workspaces, Node.js 20+ |

---

## How it works

### High-level architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React UI (renderer)                                        │
│  Checkout · Products · GRN · Returns · Reports · Settings   │
└───────────────────────────┬─────────────────────────────────┘
                            │ IPC (preload / contextBridge)
┌───────────────────────────▼─────────────────────────────────┐
│  Electron main process                                      │
│  · IPC handlers (business logic)                            │
│  · Receipt & label printing (local devices)                 │
│  · Optional: bundled local API child process                │
└───────────────┬─────────────────────────┬───────────────────┘
                │                         │
     Cloud mode │                         │ Local-only mode
                ▼                         ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│  Fastify API (:3001)      │   │  SQLite (userData/*.db)   │
│  JWT auth · REST /api/v1  │   │  Drizzle @mama-babi/      │
└───────────────┬───────────┘   │  db-schema                │
                │               └───────────────────────────┘
                ▼
┌───────────────────────────┐
│  PostgreSQL               │
│  (Supabase / VPS / LAN)   │
│  Drizzle @mama-babi/db-pg │
└───────────────────────────┘
```

### Request flow (typical cloud / bundled setup)

1. **Renderer** calls `window.electron.ipcRenderer.invoke(channel, …)` through a typed `api` helper (`apps/desktop/src/shared/api.ts`).
2. **Main process** routes the call via `withCloud()` (`apps/desktop/src/main/ipc/cloud-proxy.ts`):
   - If cloud/bundled mode is active → HTTP request to the Fastify API (`apps/desktop/src/main/cloud/client.ts`).
   - Otherwise → local SQLite handler in `apps/desktop/src/main/ipc/*.ts`.
3. **API** validates JWT + role, runs service logic (`apps/api/src/services/`), reads/writes PostgreSQL.
4. **Response** returns as `{ success, data }` or `{ success: false, error }` to the UI.

Printers, label templates, and some device settings stay **on each PC** even in cloud mode (`apps/desktop/src/shared/deviceSettings.ts`).

### Deployment modes

| Mode | Config | Data store | Typical use |
|------|--------|------------|-------------|
| **Bundled** | `resources/config.json` → `"deploymentMode": "bundled"` | PostgreSQL via API auto-started on `127.0.0.1:3001` | Windows installer; no DB on client except credentials in `secrets.json` |
| **Remote cloud** | `config.json` or `CLOUD_API_URL` → `https://your-api` | Shared PostgreSQL | Multiple PCs, one hosted API |
| **Local SQLite** | No `apiUrl` / cloud URL | SQLite file in app user data | Development without Postgres |

Bundled installers ship a compiled API bundle (`apps/desktop/api-bundle/`) and start it from the main process (`apps/desktop/src/main/localApi/server.ts`).

### Monorepo layout

```
apps/
  desktop/          Electron POS (UI + main process + IPC)
  api/              Fastify HTTP API for PostgreSQL
  owner-portal/     Web dashboard for owners (KPIs, sales) — optional

packages/
  barcode/          SKU / barcode generation (category prefixes, sequences)
  db-schema/        Drizzle schema + SQLite client (desktop local mode)
  db-pg/            Drizzle schema + PostgreSQL client, migrations, seed
  printer/          Receipt formatting helpers
  reports/          Report generators
  ui/               Shared React components (Button, Input, Spinner, …)
  sync-engine/      Cloud sync stubs (future)

docs/               Architecture, schema, IPC reference, deployment
```

### Main features

- **Checkout** — barcode/SKU lookup, cart, payments, held sales, receipts
- **Products** — categories, SKU auto-generation, Excel import, master/refine search
- **Inventory** — GRN, stocktake, purchase orders, vendor payments
- **Sales** — history, voids, returns with policy window
- **Customers & loyalty** — points, segments
- **Reports** — daily sales, EOD, inventory; owner dashboard API (`/api/v1/owner/*`)
- **Designers** — receipt and label template editors
- **Users & roles** — `super_admin`, `manager`, `cashier` with permission checks

### SKU / category prefixes

Category prefixes drive auto-generated SKUs (`SKU-{PREFIX}-0001`):

- **One word** (e.g. `Toys`) → first two letters → `TO`
- **Two+ words** (e.g. `Stuff Toys`) → first letter of each word → `ST`

Prefixes and existing product SKUs are synced on API startup (`syncSkuPrefixes` in `@mama-babi/db-pg`).

---

## Quick start (development)

### Prerequisites

- Node.js **20+**
- pnpm **9+**
- PostgreSQL (local Docker, Supabase, or LAN server) for cloud/bundled dev

### Install

```bash
pnpm install
pnpm rebuild:native   # rebuild better-sqlite3 for Electron
```

Copy environment file and set database credentials:

```bash
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET, CLOUD_API_URL
```

For bundled-style dev, also configure:

- `apps/desktop/resources/config.json` — `deploymentMode`, `apiUrl`
- `apps/desktop/resources/secrets.json` — `DATABASE_URL`, `JWT_SECRET` (see `secrets.example.json`)

### Database (PostgreSQL)

```bash
pnpm db:pg:migrate
pnpm db:pg:seed
```

Default seeded users (change in production):

| Username | Password   | Role        |
|----------|------------|-------------|
| `admin`  | `admin123` | super_admin |
| `manager`| `manager123` | manager   |
| `sales`  | `sales123` | cashier     |

### Run

```bash
# Terminal 1 — API (if not using bundled auto-start)
pnpm build:api
pnpm dev:api

# Terminal 2 — Desktop app
pnpm dev
```

Or only `pnpm dev` when `deploymentMode` is `bundled` (API starts automatically).

### Build Windows installer

```bash
cd apps/desktop
pnpm dist:win
```

See **[DEPLOY.md](DEPLOY.md)** for production API hosting, HTTPS, and installer distribution.

---

## Common scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Electron desktop app |
| `pnpm dev:api` | Start Fastify API with hot reload |
| `pnpm dev:owner` | Start owner portal (if present) |
| `pnpm build` | Build all workspace packages |
| `pnpm build:api` | Build API + dependencies |
| `pnpm build:desktop` | Build desktop renderer/main |
| `pnpm db:pg:migrate` | Apply PostgreSQL migrations |
| `pnpm db:pg:seed` | Seed PostgreSQL with defaults |
| `pnpm db:pg:sync-sku-prefixes` | Re-sync category prefixes and product SKUs |
| `pnpm typecheck` | TypeScript check across packages |

---

## API overview

Base URL: `http://host:3001/api/v1`

| Area | Examples |
|------|----------|
| Health | `GET /health`, `GET /health/db` |
| Auth | `POST /auth/login` |
| Catalog | `GET/POST /products`, `POST /products/import`, `GET/POST /categories` |
| Sales | `POST /sales`, `GET /sales`, void/hold/resume |
| Returns | `POST /returns`, sale lookup |
| GRN / vendors | goods receipt, vendor CRUD |
| Settings | store config (cloud); printers merged locally on desktop |
| Owner | `GET /owner/dashboard`, `/owner/sales`, `/owner/top-products` |

All business routes require a valid JWT except health and login.

---

## Security notes

- Passwords hashed with **bcrypt** (cost 12).
- JWT secret must be at least 16 characters; use a long random value in production.
- Role-based access on API middleware and IPC handlers.
- Append-only **audit logs** for sensitive actions.
- Never commit `.env` or `secrets.json` with real credentials.

---

## Documentation

| Document | Contents |
|----------|----------|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/02-architecture.md](docs/02-architecture.md) | Layers, IPC, offline pattern |
| [docs/08-postgresql-backend.md](docs/08-postgresql-backend.md) | Multi-PC cloud setup |
| [docs/04-database-schema.md](docs/04-database-schema.md) | Tables and relationships |
| [docs/05-api-ipc-reference.md](docs/05-api-ipc-reference.md) | IPC channel list |
| [docs/07-roles-permissions.md](docs/07-roles-permissions.md) | Role matrix |
| [DEPLOY.md](DEPLOY.md) | Production deployment guide |

---

## License

Private — Mama Babi internal use.
