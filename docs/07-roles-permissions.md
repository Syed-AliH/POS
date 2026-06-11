# Roles & Permissions

## Roles

| Role | Description |
|------|-------------|
| `super_admin` | Full system access |
| `manager` | Store operations, reports, voids |
| `cashier` | Checkout only |

## Permission Matrix (P0)

| Action | Super Admin | Manager | Cashier |
|--------|:-----------:|:-------:|:-------:|
| Checkout | Yes | Yes | Yes |
| Product CRUD | Yes | Yes | No |
| CSV Import | Yes | Yes | No |
| Void sale | Yes (PIN) | Yes (PIN) | No |
| Daily reports | Yes | Yes | No |
| Dashboard | Yes | Yes | No |
| Settings | Yes | No | No |
| Sync status | Yes | No | No |

## Manager PIN Overrides

Required for: void transactions, discount overrides (P1), price changes (P1).
