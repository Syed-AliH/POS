# Mama Babi POS Documentation

## Index

| Doc | Description |
|-----|-------------|
| [01-overview.md](01-overview.md) | Business context and design principles |
| [02-architecture.md](02-architecture.md) | System layers, offline pattern, IPC |
| [08-postgresql-backend.md](08-postgresql-backend.md) | PostgreSQL API, Docker, migrations |
| [04-database-schema.md](04-database-schema.md) | All tables and indexes |
| [05-api-ipc-reference.md](05-api-ipc-reference.md) | IPC channel reference |
| [07-roles-permissions.md](07-roles-permissions.md) | Role matrix |
| [12-development-roadmap.md](12-development-roadmap.md) | P0/P1/P2 priority tiers |

## Quick Start

```bash
pnpm install
cp .env.example .env   # if .env does not exist yet
pnpm dev
```

Default PINs (seed data): Admin `1234` | Manager `5678` | Cashier `0000`
