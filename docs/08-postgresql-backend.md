# PostgreSQL Backend & Multi-Computer Setup

Cloud database and HTTP API for Mama Babi POS. When `CLOUD_API_URL` is set, the desktop app uses the API (Supabase PostgreSQL) for shared data. Printers and receipt/label templates stay local on each machine.

## Monorepo layout

```
apps/
  desktop/          Electron POS — cloud mode via CLOUD_API_URL, or local SQLite
  api/              Fastify HTTP API (PostgreSQL)

packages/
  db-schema/        Drizzle schema + SQLite client (desktop local cache)
  db-pg/            Drizzle schema + PostgreSQL client (API)
```

## Quick start (single machine)

```bash
pnpm install
pnpm db:pg:migrate
pnpm db:pg:seed
pnpm dev:api
```

In another terminal:

```bash
pnpm dev
```

Ensure root `.env` has:

- `DATABASE_URL` — Supabase connection string (URL-encode `@` in password as `%40`)
- `JWT_SECRET` — at least 8 characters
- `CLOUD_API_URL=http://localhost:3001`

## Multi-computer setup (Admin + Manager + Salesman)

All three PCs share **one** Supabase database through **one** API server.

### 1. Run the API on one always-on machine

On the admin PC (or a small server on your LAN):

```bash
pnpm dev:api
```

The API binds to `0.0.0.0:3001` by default so other PCs on the network can connect.

Find the host machine's LAN IP (e.g. `192.168.1.50`).

### 2. Configure each desktop

On **every** POS computer, set in `.env` (or copy from `.env.example`):

```
CLOUD_API_URL=http://192.168.1.50:3001
```

Restart the desktop app after changing `.env`.

### 3. Log in with role accounts

After `pnpm db:pg:seed`, these users exist:

| Username | Password   | Role        | Typical use   |
|----------|------------|-------------|---------------|
| admin    | admin123   | super_admin | Full access   |
| manager  | manager123 | manager     | Stock, reports|
| sales    | sales123   | cashier     | Checkout only |

Change passwords in production.

### 4. What is shared vs local

| Data | Shared (cloud) | Local per PC |
|------|----------------|--------------|
| Products, stock, GRN | Yes | — |
| Sales, settings, vendors | Yes | — |
| Receipt / label printers | — | Yes |
| Receipt / label templates (cache) | — | Yes (SQLite) |

Stock entered via GRN on the manager PC is visible immediately on salesman checkout once products are in the shared database.

### 5. Firewall

Allow inbound TCP **3001** on the API host from your shop LAN.

## Verify

- `GET http://localhost:3001/api/v1/health`
- `GET http://localhost:3001/api/v1/health/db`
- Desktop login with `admin` / `admin123` when cloud mode is on

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string (required for API) |
| `API_HOST` | `0.0.0.0` | Bind address |
| `API_PORT` | `3001` | HTTP port |
| `CORS_ORIGIN` | `*` | Allowed origins |
| `JWT_SECRET` | dev default | JWT signing secret (required in production) |
| `CLOUD_API_URL` | — | Desktop → API base URL; enables cloud mode |

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev:api` | Start API with hot reload |
| `pnpm dev` | Start desktop app |
| `pnpm db:pg:migrate` | Apply Postgres migrations |
| `pnpm db:pg:seed` | Seed users, settings, default vendor/category |

## API routes (cloud mode)

- `POST /api/v1/auth/login` — JWT login
- `GET/PATCH /api/v1/settings` — store settings
- `GET/POST/PATCH /api/v1/products` — catalog & stock
- `GET/POST /api/v1/grn` — goods received (stock entries)
- `GET/POST /api/v1/sales` — checkout

Role checks: managers/admins for GRN and settings; all authenticated users for sales and product lookup.
