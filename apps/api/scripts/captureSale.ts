/**
 * Characterization harness for the sale-save path.
 *
 * Runs createSale/updateSale against the real database inside a transaction that is
 * always rolled back, then prints the resulting state as JSON. Run it before and
 * after changing the sale path and diff the two outputs — they must be identical
 * apart from the fields listed in VOLATILE_FIELDS.
 *
 *   npx tsx src/services/__golden__/captureSale.ts > before.json
 *   ...make changes...
 *   npx tsx src/services/__golden__/captureSale.ts > after.json
 *   node src/services/__golden__/diff.mjs before.json after.json
 */
import '../../../packages/db-pg/src/load-env';
import { and, eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@mama-babi/db-pg';
import { customers, inventoryMovements, products, saleItems, sales, settings } from '@mama-babi/db-pg';
import type { PostgresClient } from '@mama-babi/db-pg';
import { createSale, updateSale } from '../src/services/sales.service';

/** Ids/timestamps differ per run by design and are blanked before diffing. */
const VOLATILE_FIELDS = [
  'id',
  'saleId',
  'saleItemId',
  'customerId',
  'createdAt',
  'updatedAt',
  'referenceId',
  'saleNumber',
];

function scrub<T>(value: T): T {
  if (Array.isArray(value)) return value.map(scrub) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = VOLATILE_FIELDS.includes(k) ? '<volatile>' : scrub(v);
    }
    return out as T;
  }
  return value;
}

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const db = drizzle(pool, { schema });

  // Pick real products so prices/tax/stock are representative.
  const catalogue = await db
    .select()
    .from(products)
    .where(and(eq(products.isDeleted, false), eq(products.status, 'active')))
    .limit(3);
  if (catalogue.length < 3) throw new Error('Need at least 3 active products to characterise');

  const [cashier] = await db.select().from(schema.users).limit(1);
  const report: Record<string, unknown> = {};

  try {
    await (db as PostgresClient).transaction(async (tx) => {
      const txDb = tx as unknown as PostgresClient;

      const stockBefore = Object.fromEntries(catalogue.map((p) => [p.sku, p.stockQty]));
      const counterBefore = (
        await tx.select().from(settings).where(eq(settings.key, 'sale_counter')).limit(1)
      )[0]?.value;

      const startedAt = Date.now();
      const created = await createSale(txDb, cashier.id, {
        items: [
          { productId: catalogue[0].id, quantity: 2 },
          { productId: catalogue[1].id, quantity: 1, discountPercent: 10 },
          { productId: catalogue[2].id, quantity: 3, unitPrice: 99.5 },
        ],
        customerName: 'Golden Fixture',
        customerPhone: '03001234567',
        paymentMethod: 'cash',
        amountTendered: 100000,
        discountAmount: 50,
        discountReason: 'fixture',
        adjustmentAmount: 25,
      });

      report.createResult = scrub(created);
      if (process.env.CAPTURE_TIMING) console.error(`createSale: ${Date.now() - startedAt} ms`);

      const saleId = (created as { data?: { id: string } }).data?.id;
      if (saleId) {
        const [row] = await tx.select().from(sales).where(eq(sales.id, saleId));
        const lines = await tx.select().from(saleItems).where(eq(saleItems.saleId, saleId));
        const moves = await tx
          .select()
          .from(inventoryMovements)
          .where(eq(inventoryMovements.referenceId, saleId));
        const after = await tx
          .select()
          .from(products)
          .where(inArray(products.id, catalogue.map((p) => p.id)));

        report.saleRow = scrub(row);
        report.saleItems = scrub([...lines].sort((a, b) => a.productSku.localeCompare(b.productSku)));
        report.movements = scrub(
          [...moves].sort((a, b) => a.productId.localeCompare(b.productId)).map((m) => ({
            type: m.type,
            qtyChange: m.qtyChange,
            notes: m.notes?.replace(/MB-\d{4}-\d+/, '<saleNumber>'),
          })),
        );
        report.stockDelta = Object.fromEntries(
          after
            .map((p) => [p.sku, p.stockQty - (stockBefore[p.sku] ?? 0)] as const)
            .sort((a, b) => a[0].localeCompare(b[0])),
        );
        const counterAfter = (
          await tx.select().from(settings).where(eq(settings.key, 'sale_counter')).limit(1)
        )[0]?.value;
        report.counterIncrement = Number(counterAfter) - Number(counterBefore);

        // ── Now characterise the bill-edit path on the same sale ──────────────
        const updated = await updateSale(txDb, {
          saleId,
          items: [
            { productId: catalogue[0].id, quantity: 1 },
            { productId: catalogue[2].id, quantity: 5, unitPrice: 99.5 },
          ],
          discountAmount: 10,
          amountTendered: 100000,
        });
        report.updateResult = scrub(updated);
        const afterUpdate = await tx
          .select()
          .from(products)
          .where(inArray(products.id, catalogue.map((p) => p.id)));
        report.stockDeltaAfterUpdate = Object.fromEntries(
          afterUpdate
            .map((p) => [p.sku, p.stockQty - (stockBefore[p.sku] ?? 0)] as const)
            .sort((a, b) => a[0].localeCompare(b[0])),
        );
      }

      // Always roll back — this must never persist to the real database.
      throw new Error('__ROLLBACK__');
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== '__ROLLBACK__') throw err;
  }

  // Prove nothing leaked.
  const [leak] = await db.select().from(customers).where(eq(customers.phone, '03001234567')).limit(1);
  report.leakedCustomer = leak ? 'LEAKED — transaction did not roll back' : 'none';

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
