import { create } from 'zustand';
import type { CartItem, Customer, Product, SaleSummary } from '@shared/types';

export interface EditingSale {
  id: string;
  saleNumber: string;
  /** Total of the bill as it was last saved — the baseline for the collect/refund difference. */
  originalTotal: number;
  paymentMethod: SaleSummary['paymentMethod'];
  /** Cash actually kept by the shop for this bill (tendered minus change already returned). */
  netPaid: number;
  /**
   * Quantity of each product on the bill as it was saved.
   *
   * A negative cart quantity means "these units are coming back", so the bill is
   * charged for `originalQty - returned`. Without this baseline a line flipped from
   * 1 to -1 would swing the total by twice the price: once for dropping the sold
   * unit and again for adding a refund the customer was never charged for.
   */
  originalQtyByProduct: Record<string, number>;
}

interface CartState {
  items: CartItem[];
  /** Product id of the most recently scanned/added line — used for row highlight in checkout. */
  lastScannedProductId: string | null;
  discountAmount: number;
  discountReason: string;
  /** Manual bill adjustment: positive = surcharge (increases total), negative = extra discount. */
  adjustmentAmount: number;
  /** Manual global discount percent applied to every scanned line (and future scans). */
  globalDiscountPercent: number;
  customer: Customer | null;
  loyaltyPointsRedeemed: number;
  promotionIds: string[];
  /** Applied promo-code discount (rupees), separate from auto-promotions. */
  promoCodeDiscount: number;
  promoCodeId: string | null;
  promoCodeLabel: string;
  heldSaleId: string | null;
  /** Set when the cart is editing an already-paid bill instead of starting a new sale. */
  editingSale: EditingSale | null;
  addProduct: (product: Product, qty?: number) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  updateLineDiscount: (productId: string, discountPercent: number) => void;
  setGlobalDiscount: (discountPercent: number) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
  setDiscount: (amount: number, reason?: string, promotionIds?: string[]) => void;
  setPromoCode: (discount: number, id: string | null, label: string) => void;
  clearPromoCode: () => void;
  setAdjustment: (amount: number) => void;
  setCustomer: (customer: Customer | null) => void;
  setLoyaltyRedemption: (points: number) => void;
  setHeldSaleId: (id: string | null) => void;
  loadFromSale: (items: CartItem[]) => void;
  restoreHeldSale: (sale: SaleSummary, customer?: Customer | null) => void;
  /** Load a completed (already paid) bill into the cart for editing. */
  loadSaleForEdit: (sale: SaleSummary, customer?: Customer | null) => void;
  getSubtotal: () => number;
  getTotal: (taxInclusive: boolean) => number;
  getTax: (taxInclusive: boolean) => number;
}

function calcLineTotal(unitPrice: number, qty: number, discountPercent: number): number {
  const subtotal = unitPrice * qty;
  return subtotal - subtotal * (discountPercent / 100);
}

const emptyCart = {
  items: [] as CartItem[],
  lastScannedProductId: null as string | null,
  discountAmount: 0,
  discountReason: '',
  adjustmentAmount: 0,
  globalDiscountPercent: 0,
  customer: null as Customer | null,
  loyaltyPointsRedeemed: 0,
  promotionIds: [] as string[],
  promoCodeDiscount: 0,
  promoCodeId: null as string | null,
  promoCodeLabel: '',
  heldSaleId: null as string | null,
  editingSale: null as EditingSale | null,
};

export const useCartStore = create<CartState>((set, get) => ({
  ...emptyCart,

  addProduct: (product, qty = 1) => {
    const { items } = get();
    const existing = items.find((i) => i.productId === product.id);
    const unitPrice = product.salePrice ?? product.retailPrice;

    if (existing) {
      // Scanning onto a return line (-1) walks back up to +1 rather than parking on 0.
      const nextQty = existing.quantity + qty === 0 ? qty : existing.quantity + qty;
      set({
        lastScannedProductId: product.id,
        items: items.map((i) =>
          i.productId === product.id
            ? {
                ...i,
                quantity: nextQty,
                lineTotal: calcLineTotal(i.unitPrice, nextQty, i.discountPercent),
              }
            : i,
        ),
      });
    } else {
      const discountPercent = get().globalDiscountPercent || 0;
      set({
        lastScannedProductId: product.id,
        items: [
          ...items,
          {
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            barcode: product.barcode,
            quantity: qty,
            unitPrice,
            // Shown as a "% OFF" chip on the line; the price charged is unchanged.
            originalPrice: product.retailPrice > unitPrice ? product.retailPrice : undefined,
            discountPercent,
            taxRate: product.taxRate,
            categoryId: product.categoryId,
            lineTotal: calcLineTotal(unitPrice, qty, discountPercent),
            scannedAt: Date.now(),
          },
        ],
      });
    }
  },

  updateQuantity: (productId, quantity) => {
    // Negative quantities are returns: the line credits the customer and the sale
    // puts the stock back. Only an exact zero drops the line.
    if (!Number.isFinite(quantity) || quantity === 0) {
      get().removeItem(productId);
      return;
    }
    set({
      items: get().items.map((i) =>
        i.productId === productId
          ? { ...i, quantity, lineTotal: calcLineTotal(i.unitPrice, quantity, i.discountPercent) }
          : i,
      ),
    });
  },

  updateLineDiscount: (productId, discountPercent) => {
    set({
      items: get().items.map((i) =>
        i.productId === productId
          ? { ...i, discountPercent, lineTotal: calcLineTotal(i.unitPrice, i.quantity, discountPercent) }
          : i,
      ),
    });
  },

  setGlobalDiscount: (discountPercent) => {
    const pct = Number.isFinite(discountPercent) ? Math.min(100, Math.max(0, discountPercent)) : 0;
    set({
      globalDiscountPercent: pct,
      items: get().items.map((i) => ({
        ...i,
        discountPercent: pct,
        lineTotal: calcLineTotal(i.unitPrice, i.quantity, pct),
      })),
    });
  },

  removeItem: (productId) => {
    set({ items: get().items.filter((i) => i.productId !== productId) });
  },

  clear: () => set({ ...emptyCart }),

  setDiscount: (amount, reason = '', promotionIds = []) =>
    set({ discountAmount: amount, discountReason: reason, promotionIds }),

  setPromoCode: (discount, id, label) =>
    set({ promoCodeDiscount: Math.max(0, discount), promoCodeId: id, promoCodeLabel: label }),

  clearPromoCode: () => set({ promoCodeDiscount: 0, promoCodeId: null, promoCodeLabel: '' }),

  setAdjustment: (amount) => set({ adjustmentAmount: Number.isFinite(amount) ? amount : 0 }),

  setCustomer: (customer) => set({ customer, loyaltyPointsRedeemed: 0 }),

  setLoyaltyRedemption: (points) => set({ loyaltyPointsRedeemed: Math.max(0, points) }),

  setHeldSaleId: (id) => set({ heldSaleId: id }),

  loadFromSale: (items) =>
    set({
      items: items.map((item, index) => ({
        ...item,
        scannedAt: item.scannedAt ?? index,
      })),
      lastScannedProductId: items.length ? items[items.length - 1]!.productId : null,
    }),

  restoreHeldSale: (sale, customer = null) => {
    const base = Date.now();
    set({
      items: sale.items.map((item, index) => ({
        ...item,
        scannedAt: item.scannedAt ?? base + index,
      })),
      lastScannedProductId: sale.items.length ? sale.items[sale.items.length - 1]!.productId : null,
      discountAmount: sale.discountAmount,
      discountReason: sale.discountReason ?? '',
      adjustmentAmount: 0,
      customer,
      loyaltyPointsRedeemed: 0,
      promotionIds: [],
      promoCodeDiscount: 0,
      promoCodeId: null,
      promoCodeLabel: '',
      heldSaleId: sale.id,
      editingSale: null,
    });
  },

  loadSaleForEdit: (sale, customer = null) => {
    const base = Date.now();
    const originalQtyByProduct: Record<string, number> = {};
    for (const item of sale.items) {
      originalQtyByProduct[item.productId] = (originalQtyByProduct[item.productId] ?? 0) + item.quantity;
    }
    set({
      ...emptyCart,
      items: sale.items.map((item, index) => ({
        ...item,
        scannedAt: item.scannedAt ?? base + index,
      })),
      lastScannedProductId: sale.items.length ? sale.items[sale.items.length - 1]!.productId : null,
      customer,
      // The stored discount already nets promos, loyalty and any manual adjustment,
      // so reloading it reproduces the exact total the bill was saved with.
      discountAmount: sale.discountAmount,
      discountReason: sale.discountReason ?? '',
      editingSale: {
        id: sale.id,
        saleNumber: sale.saleNumber,
        originalTotal: sale.totalAmount,
        paymentMethod: sale.paymentMethod,
        netPaid: (sale.amountTendered ?? sale.totalAmount) - (sale.changeGiven ?? 0),
        originalQtyByProduct,
      },
    });
  },

  getSubtotal: () => get().items.reduce((sum, i) => sum + i.lineTotal, 0),

  getTax: (_taxInclusive?: boolean) => 0,

  getTotal: (_taxInclusive?: boolean) => {
    const subtotal = get().getSubtotal();
    const discount = get().discountAmount;
    const promoCodeDiscount = get().promoCodeDiscount;
    const adjustment = get().adjustmentAmount;
    return Math.max(0, subtotal - discount - promoCodeDiscount + adjustment);
  },
}));
