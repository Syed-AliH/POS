# Database Schema

SQLite via Drizzle ORM. All syncable tables include:

- `id` (UUID text PK)
- `device_id`, `branch_id`
- `is_deleted` (soft delete)
- `created_at`, `updated_at`

## Core Tables

| Table | Purpose |
|-------|---------|
| `users` | Staff accounts with PIN hash and role |
| `settings` | Key-value store configuration |
| `categories` | Product categories (hierarchical) |
| `brands` | Product brands |
| `vendors` | Suppliers |
| `customers` | CRM with loyalty points |
| `products` | Catalog with barcode, SKU, stock |
| `sales` | Transaction headers |
| `sale_items` | Line items with price snapshots |
| `inventory_movements` | Stock change audit trail |
| `purchase_orders` / `po_items` | PO management |
| `returns` / `return_items` | Return processing |
| `cash_sessions` / `shifts` | Cash reconciliation |
| `expenses` / `expense_categories` | Petty cash |
| `gift_cards` | Store credit |
| `audit_logs` | Append-only action log |
| `sync_queue` | Pending cloud sync operations |
| `promotions` | Discount rules |
| `label_templates` / `receipt_templates` | Print templates |

## Key Indexes

- `products.barcode` (unique), `products.sku` (unique)
- `sales.sale_number` (unique), `sales.created_at`
- `sale_items.sale_id`
- `inventory_movements.product_id`
- `sync_queue(status, created_at)`

## Sale Number Format

`MB-YYYY-NNNNNN` — atomic counter in `settings.sale_counter`
