# Architecture

## Layers

```
React Renderer (UI + Zustand)
        ↕ IPC (contextBridge)
Electron Main Process
  ├── SQLite (better-sqlite3 + Drizzle)
  ├── Business logic (IPC handlers)
  ├── Receipt printer (ESC/POS)
  └── Audit logging
```

## Offline Pattern

- All reads/writes go to local SQLite
- No network calls in checkout hot path
- `sync_queue` table logs changes for future cloud sync (currently disabled)
- Cloud API (`apps/server`) deferred to P3

## Monorepo Structure

```
apps/desktop/       Electron POS app (SQLite, offline-first)
apps/api/           Fastify HTTP API (PostgreSQL)
packages/
  db-schema/        Drizzle schema + SQLite client (desktop)
  db-pg/            Drizzle schema + PostgreSQL client (API)
  barcode/          SKU/barcode generation
  printer/          Receipt formatting
  reports/          Report generators
  ui/               Shared React components
  sync-engine/      Cloud sync stubs
docs/               This documentation
```

See [08-postgresql-backend.md](./08-postgresql-backend.md) for API setup and migrations.

## Data stores

| Runtime | Database | Access |
|---------|----------|--------|
| Desktop | SQLite (`userData/mama-babi.db`) | IPC → Drizzle (`@mama-babi/db-schema`) |
| API | PostgreSQL | HTTP → Drizzle (`@mama-babi/db-pg`) |

## Security

- PIN hashed with bcrypt (cost 12)
- Role checks on every IPC handler
- Manager PIN required for voids
- Append-only audit logs
