# Mama Babi POS

Offline-first Point of Sale system for Mama Babi baby products retail store.

## Stack

- **Desktop:** Electron + React + Vite + TypeScript
- **Local DB:** SQLite (better-sqlite3) + Drizzle ORM
- **State:** Zustand
- **Styling:** Tailwind CSS

## Quick Start

```bash
pnpm install

# If Electron download fails, use a mirror (Windows):
# $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
# node node_modules/electron/install.js

# Rebuild native modules for Electron:
pnpm rebuild:native

pnpm dev
```

**Default PINs:** Admin `1234` | Manager `5678` | Cashier `0000`

## Project Structure

```
apps/desktop/     Electron POS application
packages/
  db-schema/      Drizzle schema, migrations, seed
  barcode/        Barcode generation (Code128)
  printer/        Thermal receipt/label printing
  reports/        PDF/Excel report generators
  ui/             Shared React components
  sync-engine/    Cloud sync stubs (deferred)
docs/             Architecture and module documentation
```

## Documentation

See [docs/README.md](docs/README.md) for full documentation index.

## Delivery Tiers

- **P0 Go-Live:** Checkout, products, receipt, stock
- **P1 Operations:** Returns, POs, loyalty, EOD, backup
- **P2 Polish:** Designers, gift cards, full reports, SQLCipher
