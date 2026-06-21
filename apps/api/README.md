# Mama Babi POS — API

HTTP backend for cloud sync, multi-branch reporting, and future web clients.

## Stack

- **Fastify** — HTTP server
- **PostgreSQL** — primary cloud database
- **Drizzle ORM** — via `@mama-babi/db-pg`

## Development

1. Start Postgres (from repo root):

   ```bash
   docker compose up -d postgres
   ```

2. Copy env and run migrations:

   ```bash
   cp .env.example .env
   pnpm db:pg:generate   # after schema changes
   pnpm db:pg:migrate
   ```

3. Start the API:

   ```bash
   pnpm dev:api
   ```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Service health |
| GET | `/api/v1/health/db` | Database connectivity |

## Layout

```
src/
  index.ts          # Entry point
  app.ts            # Fastify app factory
  config.ts         # Environment validation
  plugins/
    database.ts     # Drizzle Postgres connection
  routes/
    health.ts       # Health checks
    index.ts        # Route registration
```

Business routes (products, sales, sync) will be added under `src/routes/` and `src/services/` as the cloud layer grows.
