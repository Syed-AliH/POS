# Mama Babi POS

pnpm monorepo: an Electron till, a Fastify cloud API, and a web owner portal that
share one Postgres schema.

```
apps/desktop       Electron POS (renderer + main). Local SQLite, optional cloud mode.
apps/api           Fastify API over Postgres/Supabase. Serves the desktop in cloud mode.
apps/owner-portal  Vite + React owner dashboard. SEPARATE GIT REPO — see below.
packages/*         printer, barcode, db-pg, db-schema, reports, sync-engine, ui
```

## The three-backend rule (read this before fixing any bug)

The same business logic is implemented **three times**, against three different data
layers. A fix in one place fixes nothing anywhere else:

| Concern | Desktop (SQLite) | Cloud (Postgres) | Owner portal (raw SQL) |
|---|---|---|---|
| Sales | `apps/desktop/src/main/ipc/sales.ts` | `apps/api/src/services/sales.service.ts` | — |
| Products | `apps/desktop/src/main/ipc/products.ts` | `apps/api/src/services/products.service.ts` | `apps/owner-portal/api/_lib/products.ts` |
| GRN | `apps/desktop/src/main/ipc/grn.ts` | `apps/api/src/services/grn.service.ts` | — |
| Reports | `apps/desktop/src/main/ipc/reports.ts` | `apps/api/src/services/reports.service.ts` | `apps/owner-portal/api/_lib/reports.ts` |
| SKU sync | `apps/desktop/src/main/services/syncSkuPrefixes.ts` | `packages/db-pg/src/sync-sku-prefixes.ts` | — |

**Which one actually runs?** The header badge in the app says `Online` or `Offline`.
Online means `withCloud()` ([apps/desktop/src/main/ipc/cloud-proxy.ts](apps/desktop/src/main/ipc/cloud-proxy.ts))
forwards the IPC channel to the Fastify API, and the local SQLite handler never
executes. A fix that only lands in the local handler will look like it did nothing.

Run `/parity-check` when touching sale, product, GRN, or report logic.

## Stale builds bite

`apps/api` runs under `tsx watch`, which only watches `apps/api/src`. Anything under
`packages/*` is imported from its built `dist/`, so **source changes there are invisible
until you rebuild**:

```bash
pnpm --filter @mama-babi/db-pg build     # or: pnpm -r build
```

Symptom: a stack trace pointing at a source line that no longer contains that code.

## The owner portal is a separate repository

`apps/owner-portal` is a nested git repo (`Admin_POS_Dashboard`, branch **master**),
recorded in the monorepo as a gitlink. Vercel builds it **standalone**, so:

- It cannot use `workspace:*` dependencies — nothing from `packages/*` resolves there.
  Shared code must be vendored into `apps/owner-portal/src/vendor/`.
- Shipping a portal change is two commits: the portal repo (`master`), then the
  monorepo (`main`), which records the new pointer.

The portal talks to Vercel serverless functions (`apps/owner-portal/api/**`) in
production, but to the Fastify API (`VITE_API_URL=http://localhost:3001`) in local dev
— **a new portal endpoint must be added in both places** or it 500s locally.

## Money and stock invariants

- Cart quantities may be **negative** — that's a return line. It lowers the bill and
  puts stock back. Only an exact `0` removes a line. Never filter on `quantity <= 0`.
- Stock is always a **relative** delta (`stockQty - quantity`), never an absolute set,
  so concurrent sales stay correct.
- Cost price is not stored per sale line; reports join the product's *current*
  `cost_price`. Say so wherever a margin is displayed.
- The till's catalogue payload (`SearchProduct`) carries **no cost price** — anything
  pricing on cost (GRN lines) must re-read the full product row.
- `Math.max(0, …)` on sale totals means an all-return bill saves as 0. Known gap.

## Commands

```bash
pnpm dev                 # desktop app
pnpm dev:api             # Fastify API (:3001)
pnpm dev:owner           # owner portal
pnpm -r build            # everything (needed after packages/* changes)
pnpm --filter @mama-babi/<pkg> typecheck
```

Release: bump `apps/desktop/package.json`, then `/release`. Installers publish to
GitHub Releases and existing tills auto-update via electron-updater.

## Conventions

- There are **no tests and no linter**. Typecheck is the only automated gate —
  a PostToolUse hook runs it for the package you edited.
- Comments explain *why*, not *what*, and are written for someone reading the code
  cold. Match the density of the surrounding file.
- Never edit files marked `GENERATED FILE`, `apps/desktop/resources/secrets.json`,
  or `.env*`.
