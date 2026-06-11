# Overview

Mama Babi POS is an offline-first Point of Sale system for a baby products retail store.

## Store Profile

- **Business:** Baby products retail (clothing, diapers, food, toys, care)
- **Model:** Brick-and-mortar, single store (multi-branch ready)
- **Currency:** PKR (default)
- **Tax:** GST 17% (configurable, inclusive/exclusive)

## Design Principles

1. **Offline-first** — all operations work without internet
2. **Speed-first** — barcode scan checkout under 10 seconds
3. **Role-based access** — cashiers cannot access management
4. **Data integrity** — ACID transactions, WAL mode SQLite
5. **Future sync-ready** — all tables include `device_id`, `branch_id`, sync metadata

## Delivery Tiers

- **P0 Go-Live:** Checkout, products, receipt, stock (current focus)
- **P1 Operations:** Returns, POs, loyalty, EOD, backup
- **P2 Polish:** Designers, gift cards, full reports, SQLCipher
- **P3 Future:** Cloud sync, multi-branch, e-commerce
