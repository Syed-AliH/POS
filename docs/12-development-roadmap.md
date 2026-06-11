# Development Roadmap

Urgent delivery — priority tiers, no fixed calendar.

## P0 Go-Live (Current)

- [x] Monorepo scaffold
- [x] Full database schema
- [x] PIN login + roles
- [x] Checkout screen + barcode scan
- [x] Product CRUD + CSV import
- [x] Sale transaction + stock decrement
- [x] Receipt print (electron-pos-printer with preview fallback)
- [x] Daily sales report
- [x] Dashboard + sales history
- [x] Hold/resume sale (F2/F3)
- [x] Auto-lock after 5 min inactivity
- [ ] Windows installer build verified
- [ ] Hardware printer configured (set `receipt_printer` in settings)

## P1 Operations (In Progress)

- [x] Returns and exchanges
- [x] Inventory adjustments + low stock alerts
- [x] Shift open/close + EOD/Z-report
- [x] Backup/restore
- [ ] Purchase orders + vendor receive
- [ ] Customer CRM + loyalty
- [ ] Promotions engine
- [ ] Label batch print

## P2 Polish

- [ ] Label/receipt designers
- [ ] Gift cards + multi-currency
- [ ] Full report suite
- [ ] SQLCipher encryption
- [ ] Audit log viewer
- [ ] Stocktake module

## P3 Future

- [ ] Cloud sync (Supabase)
- [ ] Multi-branch
- [ ] E-commerce integration
