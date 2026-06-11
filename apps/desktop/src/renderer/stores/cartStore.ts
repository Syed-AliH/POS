import { create } from 'zustand';
import type { CartItem, Customer, Product, SaleSummary } from '@shared/types';

interface CartState {
  items: CartItem[];
  discountAmount: number;
  discountReason: string;
  customer: Customer | null;
  loyaltyPointsRedeemed: number;
  promotionIds: string[];
  heldSaleId: string | null;
  addProduct: (product: Product, qty?: number) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  updateLineDiscount: (productId: string, discountPercent: number) => void;
  removeItem: (productId: string) => void;
  clear: () => void;
  setDiscount: (amount: number, reason?: string, promotionIds?: string[]) => void;
  setCustomer: (customer: Customer | null) => void;
  setLoyaltyRedemption: (points: number) => void;
  setHeldSaleId: (id: string | null) => void;
  loadFromSale: (items: CartItem[]) => void;
  restoreHeldSale: (sale: SaleSummary, customer?: Customer | null) => void;
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
  discountAmount: 0,
  discountReason: '',
  customer: null as Customer | null,
  loyaltyPointsRedeemed: 0,
  promotionIds: [] as string[],
  heldSaleId: null as string | null,
};

export const useCartStore = create<CartState>((set, get) => ({
  ...emptyCart,

  addProduct: (product, qty = 1) => {
    const { items } = get();
    const existing = items.find((i) => i.productId === product.id);
    const unitPrice = product.salePrice ?? product.retailPrice;

    if (existing) {
      set({
        items: items.map((i) =>
          i.productId === product.id
            ? {
                ...i,
                quantity: i.quantity + qty,
                lineTotal: calcLineTotal(i.unitPrice, i.quantity + qty, i.discountPercent),
              }
            : i,
        ),
      });
    } else {
      set({
        items: [
          ...items,
          {
            productId: product.id,
            productName: product.name,
            productSku: product.sku,
            barcode: product.barcode,
            quantity: qty,
            unitPrice,
            discountPercent: 0,
            taxRate: product.taxRate,
            lineTotal: calcLineTotal(unitPrice, qty, 0),
          },
        ],
      });
    }
  },

  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) {
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

  removeItem: (productId) => {
    set({ items: get().items.filter((i) => i.productId !== productId) });
  },

  clear: () => set({ ...emptyCart }),

  setDiscount: (amount, reason = '', promotionIds = []) =>
    set({ discountAmount: amount, discountReason: reason, promotionIds }),

  setCustomer: (customer) => set({ customer, loyaltyPointsRedeemed: 0 }),

  setLoyaltyRedemption: (points) => set({ loyaltyPointsRedeemed: Math.max(0, points) }),

  setHeldSaleId: (id) => set({ heldSaleId: id }),

  loadFromSale: (items) => set({ items }),

  restoreHeldSale: (sale, customer = null) => {
    set({
      items: sale.items,
      discountAmount: sale.discountAmount,
      discountReason: '',
      customer,
      loyaltyPointsRedeemed: 0,
      promotionIds: [],
      heldSaleId: sale.id,
    });
  },

  getSubtotal: () => get().items.reduce((sum, i) => sum + i.lineTotal, 0),

  getTax: (taxInclusive) => {
    const items = get().items;
    if (taxInclusive) {
      return items.reduce((sum, i) => sum + (i.lineTotal - i.lineTotal / (1 + i.taxRate / 100)), 0);
    }
    return items.reduce((sum, i) => sum + i.lineTotal * (i.taxRate / 100), 0);
  },

  getTotal: (taxInclusive) => {
    const subtotal = get().getSubtotal();
    const discount = get().discountAmount;
    if (taxInclusive) return subtotal - discount;
    return subtotal - discount + get().getTax(taxInclusive);
  },
}));
