import type { MamaBabiAPI } from '@shared/api';

export type ProductImportRow = {
  name: string;
  category: string;
  cost_price?: number;
  retail_price: number;
  sale_price?: number;
};

/** Import products row-by-row using existing create/category APIs (works in cloud + local). */
export async function importProductsViaApi(
  api: MamaBabiAPI,
  rows: ProductImportRow[],
): Promise<{ imported: number; errors: string[] }> {
  const catResult = await api.categories.list();
  if (!catResult.success) {
    throw new Error(catResult.error ?? 'Failed to load categories');
  }

  const categoryByName = new Map(
    (catResult.data ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]),
  );

  const errors: string[] = [];
  let imported = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;
    const name = row.name.trim();
    const categoryName = row.category.trim();

    if (!name) {
      errors.push(`Row ${rowNum}: Name is required`);
      continue;
    }
    if (!categoryName) {
      errors.push(`Row ${rowNum} "${name}": Category is required`);
      continue;
    }
    if (!row.retail_price || row.retail_price <= 0) {
      errors.push(`Row ${rowNum} "${name}": Valid Retail Price is required`);
      continue;
    }

    let categoryId = categoryByName.get(categoryName.toLowerCase());
    if (!categoryId) {
      const created = await api.categories.create(categoryName);
      if (!created.success || !created.data) {
        errors.push(`Row ${rowNum} "${name}": ${created.error ?? 'Failed to create category'}`);
        continue;
      }
      categoryId = created.data.id;
      categoryByName.set(categoryName.toLowerCase(), categoryId);
    }

    const result = await api.products.create({
      name,
      categoryId,
      costPrice: row.cost_price ?? 0,
      retailPrice: row.retail_price,
      salePrice: row.sale_price,
      taxRate: 0,
      stockQty: 0,
    });

    if (result.success) imported++;
    else errors.push(`Row ${rowNum} "${name}": ${result.error ?? 'Create failed'}`);
  }

  return { imported, errors };
}
