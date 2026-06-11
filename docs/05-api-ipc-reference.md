# IPC API Reference

All channels use `ipcMain.handle` / `ipcRenderer.invoke`. Business logic runs in the main process only.

## Auth

| Channel | Args | Returns | Permission |
|---------|------|---------|------------|
| `auth:login` | `pin: string` | `ApiResult<UserSession>` | Public |
| `auth:logout` | — | `ApiResult<void>` | Session |
| `auth:get-session` | — | `ApiResult<UserSession \| null>` | Public |
| `auth:verify-manager-pin` | `pin: string` | `ApiResult<boolean>` | Session |

## Products

| Channel | Args | Returns | Permission |
|---------|------|---------|------------|
| `product:search` | `query: string` | `ApiResult<Product[]>` | Session |
| `product:list` | `{ status?, limit? }` | `ApiResult<Product[]>` | Session |
| `product:get` | `id: string` | `ApiResult<Product>` | Session |
| `product:create` | `ProductInput` | `ApiResult<Product>` | Manager+ |
| `product:update` | `id, Partial<ProductInput>` | `ApiResult<Product>` | Manager+ |
| `product:barcode-lookup` | `barcode: string` | `ApiResult<Product \| null>` | Session |
| `product:import-csv` | `csv: string` | `ApiResult<{ imported, errors }>` | Manager+ |
| `category:list` | — | `ApiResult<Category[]>` | Session |

## Sales

| Channel | Args | Returns | Permission |
|---------|------|---------|------------|
| `sale:create` | `CreateSaleInput` | `ApiResult<SaleSummary>` | Session |
| `sale:list` | `{ limit?, status? }` | `ApiResult<SaleSummary[]>` | Session |
| `sale:get` | `id: string` | `ApiResult<SaleSummary>` | Session |
| `sale:void` | `id, managerPin` | `ApiResult<SaleSummary>` | Session + Manager PIN |
| `sale:resume` | `heldKey: string` | `ApiResult<SaleSummary>` | Session |

## Other

| Channel | Args | Returns | Permission |
|---------|------|---------|------------|
| `settings:get` | `key` | `ApiResult<string>` | Session |
| `settings:get-all` | — | `ApiResult<Record<string,string>>` | Session |
| `sync:status` | — | `ApiResult<{ enabled, pending }>` | Admin |
| `print:receipt` | `saleId` | `ApiResult<void>` | Session |
| `report:daily-sales` | `date?` | `ApiResult<{ totalSales, transactionCount }>` | Manager+ |

## Error Format

```typescript
{ success: false, error: "Human-readable message" }
{ success: true, data: T }
```
