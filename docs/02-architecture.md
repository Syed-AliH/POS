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
apps/desktop/       Electron POS app
packages/
  db-schema/        Drizzle schema + migrations
  barcode/          SKU/barcode generation
  printer/          Receipt formatting
  reports/          Report generators
  ui/               Shared React components
  sync-engine/      Cloud sync stubs
docs/               This documentation
```

## Security

- PIN hashed with bcrypt (cost 12)
- Role checks on every IPC handler
- Manager PIN required for voids
- Append-only audit logs
