import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, cn } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { focusElement, getActiveRoute, registerPageShortcuts } from '@renderer/lib/shortcuts';
import { Modal, ModalActions } from '@renderer/components/Modal';
import { ProductHistoryModal } from '@renderer/components/ProductHistoryModal';
import { ProductSearchModal } from '@renderer/components/ProductSearchModal';
import { ReceiptSearchModal } from '@renderer/components/ReceiptSearchModal';
import { WorkflowStepper } from '@renderer/components/WorkflowStepper';
import { toast } from '@renderer/stores/toastStore';
import { mark, measure, timeAsync } from '@shared/perf';
import { useAuthStore } from '@renderer/stores/authStore';
import type { Customer, Product, PromoCode, SaleSummary, SearchProduct } from '@shared/types';
import { useCartStore } from '../stores/cartStore';
import { findCachedByBarcode, searchCachedProducts, useProductSearchStore } from '../stores/productSearchStore';

const api = getApi();

type PaymentMethod = 'cash' | 'card' | 'wallet' | 'online';

function saleCustomerPayload(
  customer: Customer | null,
  customerName: string,
  customerPhone: string,
) {
  const name = (customer?.name ?? customerName).trim();
  const phone = (customer?.phone ?? customerPhone).trim();
  return {
    customerId: customer?.id,
    customerName: name || undefined,
    customerPhone: phone || undefined,
  };
}

/** The cached search rows carry only what the till needs; pad them out for the cart. */
function toProduct(p: SearchProduct): Product {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode ?? '',
    categoryId: p.categoryId,
    brandId: null,
    vendorId: null,
    costPrice: 0,
    retailPrice: p.retailPrice,
    salePrice: p.salePrice,
    taxRate: p.taxRate,
    stockQty: p.stockQty,
    reorderLevel: 0,
    status: 'active',
    imagePath: null,
    description: null,
  };
}

const WORKFLOW_STEPS = [
  { id: 'search', label: 'Find product', hint: 'F1 search or scan barcode' },
  { id: 'cart', label: 'Review cart', hint: 'Adjust qty and discounts' },
  { id: 'pay', label: 'Take payment', hint: 'F4 to charge' },
  { id: 'done', label: 'Complete', hint: 'Receipt & return if needed' },
];

export function CheckoutPage() {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const isManager = session?.role === 'manager' || session?.role === 'super_admin';

  // Catalogue cached in memory: search and barcode lookups cost no network.
  const loadCatalogue = useProductSearchStore((s) => s.load);
  const applySoldToCatalogue = useProductSearchStore((s) => s.applySold);
  const catalogueById = useProductSearchStore((s) => s.byId);
  const catalogueCount = useProductSearchStore((s) => s.products.length);

  const {
    items, lastScannedProductId, discountAmount, discountReason, adjustmentAmount, globalDiscountPercent, promotionIds, promoCodeDiscount, promoCodeId, promoCodeLabel, customer, loyaltyPointsRedeemed, heldSaleId, editingSale,
    addProduct, updateQuantity, updateLineDiscount, setGlobalDiscount, removeItem, clear,
    setDiscount, setPromoCode, clearPromoCode, setAdjustment, setCustomer, setLoyaltyRedemption, restoreHeldSale,
    getSubtotal,
  } = useCartStore();

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [productCount, setProductCount] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountTendered, setAmountTendered] = useState('');
  const [adjustmentInput, setAdjustmentInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [heldSales, setHeldSales] = useState<SaleSummary[]>([]);
  const [showHeld, setShowHeld] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [showReceipts, setShowReceipts] = useState(false);
  const [redemptionRate, setRedemptionRate] = useState(1);
  const [appliedPromos, setAppliedPromos] = useState<string[]>([]);
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoCodeApplying, setPromoCodeApplying] = useState(false);
  const [promoList, setPromoList] = useState<PromoCode[] | null>(null);
  const [showPromoList, setShowPromoList] = useState(false);
  const [promoListLoading, setPromoListLoading] = useState(false);
  const [giftCardCode, setGiftCardCode] = useState('');
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
  const [giftCardLoading, setGiftCardLoading] = useState(false);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [stockWarning, setStockWarning] = useState<{ productName: string; stock: number } | null>(null);
  const [historyProduct, setHistoryProduct] = useState<{ id: string; name: string } | null>(null);
  // Qty cell being typed into — kept as raw text so "-" and an empty box are valid mid-edit.
  const [qtyDraft, setQtyDraft] = useState<{ productId: string; value: string } | null>(null);
  /** Set only when a charge is attempted with no cash typed — never before. */
  const [tenderPrompt, setTenderPrompt] = useState(false);
  const latestCartRowRef = useRef<HTMLTableRowElement | null>(null);

  /**
   * What the bill is actually charged for, per line.
   *
   * A negative quantity means "this many units are coming back". The bill therefore
   * charges for `originalQty - returned`: flipping a line that was sold on this bill
   * from 1 to -1 takes it off the bill (charge 0), it does not additionally refund a
   * unit the customer never paid for. Outside edit mode there is no original
   * quantity, so a return line stays negative and credits the customer as before.
   */
  const billedItems = useMemo(() => {
    const originalQty = editingSale?.originalQtyByProduct ?? {};
    return items.map((item) => {
      const billedQty = item.quantity >= 0
        ? item.quantity
        : (originalQty[item.productId] ?? 0) - Math.abs(item.quantity);
      const gross = item.unitPrice * billedQty;
      const billedLineTotal = gross - gross * (item.discountPercent / 100);
      // What the line is worth to the customer on screen: a returned unit that was
      // already paid for is money coming back, so show the credit rather than 0.00.
      const returnedUnits = item.quantity < 0 ? Math.abs(item.quantity) : 0;
      const refundGross = item.unitPrice * returnedUnits;
      const refund = refundGross - refundGross * (item.discountPercent / 100);
      return {
        ...item,
        billedQty,
        billedLineTotal,
        displayLineTotal: returnedUnits > 0 ? -refund : billedLineTotal,
      };
    });
  }, [items, editingSale]);

  const cartItemsInScanOrder = useMemo(
    () => [...billedItems].sort((a, b) => (a.scannedAt ?? 0) - (b.scannedAt ?? 0)),
    [billedItems],
  );

  useEffect(() => {
    if (!lastScannedProductId) return;
    latestCartRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [lastScannedProductId, items.length]);

  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customerDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const tenderRef = useRef<HTMLInputElement>(null);
  const handleChargeRef = useRef<(options?: { forcePrint?: boolean }) => void>(() => undefined);
  /** Read once at mount from settings.getAll() instead of re-fetched on every sale. */
  const autoPrintRef = useRef(true);
  /** Scanner state kept out of React so a scan does not re-render per character. */
  const barcodeBufferRef = useRef('');
  const showHeldRef = useRef(false);
  const lookupBarcodeRef = useRef<(code: string) => void | Promise<void>>(() => undefined);

  const isEditingBill = !!editingSale;
  const loyaltyDiscount = isEditingBill ? 0 : loyaltyPointsRedeemed * redemptionRate;

  const cartItemCount = useMemo(
    () => billedItems.reduce((sum, i) => sum + Math.abs(i.billedQty), 0),
    [billedItems],
  );

  const subtotal = useMemo(
    () => billedItems.reduce((sum, i) => sum + i.billedLineTotal, 0),
    [billedItems],
  );
  /** Credit carried by the returned lines, shown beside the settlement. */
  const returnTotal = useMemo(
    () => billedItems.reduce((sum, i) => (i.billedLineTotal < 0 ? sum - i.billedLineTotal : sum), 0),
    [billedItems],
  );
  /** What the bill is worth now — the goods the customer is keeping, after discounts. */
  const netTotal = subtotal - discountAmount - promoCodeDiscount + adjustmentAmount - loyaltyDiscount;
  const total = Math.max(0, netTotal);
  /**
   * Cash still to move, and in which direction.
   *
   * Editing a bill that was already paid is not a fresh sale: the shop is holding the
   * customer's money. Settling on the new bill total alone would ask him to pay again
   * for goods he has already paid for — returning a 24,800 stroller and buying 180 of
   * pins would read as "take 180" when the shop in fact owes him 24,620.
   */
  const alreadyPaid = isEditingBill ? (editingSale?.netPaid ?? 0) : 0;
  const settlementDelta = total - alreadyPaid;
  const amountToCollect = Math.max(0, settlementDelta);
  const amountToRefund = Math.max(0, -settlementDelta);
  const editCashChange = isEditingBill
    ? Math.max(0, parseFloat(amountTendered || '0') - amountToCollect)
    : 0;
  /** Something typed, but not enough to cover the bill. */
  const tenderShort =
    !isEditingBill && paymentMethod === 'cash' && !!amountTendered.trim() &&
    parseFloat(amountTendered || '0') < total;
  const change = isEditingBill
    ? editCashChange
    : paymentMethod === 'cash' ? Math.max(0, parseFloat(amountTendered || '0') - total) : 0;

  /**
   * One place that spells out which way the cash moves, so the banner, the summary
   * card and the confirm button can never disagree about it.
   */
  const settlement = useMemo(() => {
    if (amountToRefund > 0.009) {
      return {
        direction: 'refund' as const,
        amount: amountToRefund,
        /** What the cashier physically does. */
        action: 'Give back',
        short: 'Give back',
        icon: '↩',
      };
    }
    if (amountToCollect > 0.009) {
      return {
        direction: 'collect' as const,
        amount: amountToCollect,
        action: 'Take',
        short: 'Take',
        icon: '↓',
      };
    }
    return { direction: 'settled' as const, amount: 0, action: '', short: '', icon: '' };
  }, [amountToCollect, amountToRefund]);

  const workflowStep = items.length === 0
    ? 0
    : isEditingBill
      ? (amountToCollect > 0.009 && !amountTendered ? 1 : 2)
      : paymentMethod === 'cash' && !amountTendered ? 1 : 2;

  /** Reloads the cached catalogue (stock included) — used after a bill edit. */
  const refreshStockMap = useCallback(async () => {
    await loadCatalogue(true);
  }, [loadCatalogue]);

  const getOnHandStock = useCallback((productId: string, fallback = 0) => (
    catalogueById.get(productId)?.stockQty ?? stockMap[productId] ?? fallback
  ), [catalogueById, stockMap]);

  // Quantity already in the cart, by product — avoids an items.find() per row per render.
  const cartQtyById = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of billedItems) map.set(i.productId, (map.get(i.productId) ?? 0) + i.billedQty);
    return map;
  }, [billedItems]);

  const getAvailableStock = useCallback((productId: string, fallbackOnHand = 0) => (
    getOnHandStock(productId, fallbackOnHand) - (cartQtyById.get(productId) ?? 0)
  ), [getOnHandStock, cartQtyById]);

  /** Applies a new quantity and warns if selling more than what is on hand. */
  const applyQuantity = useCallback((productId: string, productName: string, quantity: number) => {
    updateQuantity(productId, quantity);
    const onHand = getOnHandStock(productId);
    if (quantity > 0 && onHand - quantity < 0) {
      setStockWarning({ productName, stock: onHand });
    }
  }, [updateQuantity, getOnHandStock]);

  /**
   * +/- and the arrow keys step by one and skip straight over zero, so a line goes
   * 1 → -1 (a return) instead of vanishing, and -1 → 1 on the way back up.
   */
  const stepQuantity = useCallback((productId: string, current: number, step: number) => {
    const item = items.find((i) => i.productId === productId);
    const next = current + step === 0 ? current + step * 2 : current + step;
    setQtyDraft(null);
    applyQuantity(productId, item?.productName ?? '', next);
  }, [items, applyQuantity]);

  /** Commits the typed quantity; blank or unparseable text reverts to the current value. */
  const commitQtyDraft = useCallback((productId: string, current: number) => {
    const draft = qtyDraft;
    setQtyDraft(null);
    if (!draft || draft.productId !== productId) return;
    const parsed = parseInt(draft.value, 10);
    if (!Number.isFinite(parsed) || parsed === current) return;
    const item = items.find((i) => i.productId === productId);
    applyQuantity(productId, item?.productName ?? '', parsed);
  }, [qtyDraft, items, applyQuantity]);

  useEffect(() => {
    api.customers.loyaltyRules().then((r) => {
      if (r.success && r.data?.[0]) setRedemptionRate(r.data[0].redemptionRate);
    });
    // One settings read for the auto-print flag; the charge path used to fetch
    // auto_print_receipt again on every sale.
    api.settings.getAll().then((r) => {
      if (r.success && r.data) {
        autoPrintRef.current = r.data.auto_print_receipt !== 'false';
      }
    });
    void loadCatalogue();
  }, [loadCatalogue]);

  useEffect(() => {
    setProductCount(catalogueCount);
  }, [catalogueCount]);

  useEffect(() => {
    // Editing a saved bill: keep the discount the bill was saved with instead of
    // re-running today's promotions over it.
    if (editingSale) return;
    if (!items.length) {
      setDiscount(0);
      setAppliedPromos([]);
      return;
    }
    // Debounce so rapid scanning doesn't fire a promo preview per item.
    const timer = setTimeout(() => {
      const subtotal = getSubtotal();
      api.promotions.preview({
        subtotal,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, categoryId: i.categoryId })),
      }).then((r) => {
        if (r.success && r.data?.length) {
          const totalPromo = r.data.reduce((sum, p) => sum + p.discountAmount, 0);
          const names = r.data.map((p) => p.promotionName).join(', ');
          const ids = r.data.map((p) => p.promotionId);
          setDiscount(totalPromo, names, ids);
          setAppliedPromos(names.split(', '));
        } else {
          setDiscount(0, '', []);
          setAppliedPromos([]);
        }
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [items, getSubtotal, setDiscount, editingSale]);

  const addProductSafe = useCallback(async (product: Product) => {
    mark('cart.add');
    // The scanned/searched product already carries a fresh stockQty from the lookup,
    // so avoid an extra per-scan network round-trip and use the known/cached value.
    const onHand = stockMap[product.id] ?? product.stockQty;
    setStockMap((prev) => ({ ...prev, [product.id]: onHand }));

    const inCart = items.find((i) => i.productId === product.id)?.quantity ?? 0;
    const available = onHand - inCart;
    const sellingIntoNegative = available <= 0;

    addProduct(product);

    if (sellingIntoNegative) {
      setStockWarning({ productName: product.name, stock: onHand });
    }
    setSearch('');
    setSearchResults([]);
    setSearchIndex(0);
    measure('cart.add');
    return true;
  }, [items, stockMap, addProduct]);

  const lookupBarcode = useCallback(async (barcode: string) => {
    // Scanner path: hit the in-memory index first so a scan adds instantly.
    const cached = findCachedByBarcode(barcode);
    if (cached) {
      addProductSafe(toProduct(cached));
      return;
    }
    // Miss — a product created since the catalogue was cached. Ask the server.
    const result = await api.products.barcodeLookup(barcode.trim());
    if (result.success && result.data) {
      addProductSafe(result.data);
    } else {
      toast.error(`No product for barcode: ${barcode}`);
    }
  }, [addProductSafe]);

  const loadHeldSales = useCallback(async () => {
    const result = await api.sales.list({ status: 'held', limit: 20 });
    if (result.success) {
      setHeldSales(result.data ?? []);
      setShowHeld(true);
    }
  }, []);

  const handleHold = useCallback(async () => {
    if (!items.length || processing) return;
    if (editingSale) {
      toast.warning('Finish or cancel the bill edit before holding a sale');
      return;
    }
    setProcessing(true);
    if (heldSaleId) await api.sales.discardHeld(heldSaleId);
    const heldKey = `H${Date.now().toString(36).toUpperCase()}`;
    const result = await api.sales.create({
      // unitPrice is sent so the sale records exactly the price shown in the cart —
      // a resumed hold keeps its saved prices even if the product was re-priced since.
      items: billedItems.map((i) => ({ productId: i.productId, quantity: i.billedQty, discountPercent: i.discountPercent, unitPrice: i.unitPrice })),
      ...saleCustomerPayload(customer, customerName, customerPhone),
      paymentMethod: 'cash',
      status: 'held',
      heldKey,
      discountAmount: (discountAmount + promoCodeDiscount) || undefined,
      adjustmentAmount: adjustmentAmount || undefined,
      promotionIds: promotionIds.length ? promotionIds : undefined,
    });
    if (result.success) {
      toast.info(`Sale held: ${heldKey} — resume with F3`);
      clear();
    } else toast.error(result.error ?? 'Hold failed');
    setProcessing(false);
  }, [items, customer, customerName, customerPhone, discountAmount, promoCodeDiscount, adjustmentAmount, promotionIds, heldSaleId, clear, processing, editingSale]);

  const handleDiscardHeld = async (saleId: string) => {
    const result = await api.sales.discardHeld(saleId);
    if (result.success) {
      if (heldSaleId === saleId) clear();
      loadHeldSales();
      toast.info('Held sale discarded');
    }
  };

  const handleResume = async (sale: SaleSummary) => {
    if (!sale.heldKey) return;
    let attachedCustomer: Customer | null = null;
    if (sale.customerId) {
      const c = await api.customers.get(sale.customerId);
      if (c.success && c.data) attachedCustomer = c.data;
    }
    restoreHeldSale(sale, attachedCustomer);
    if (attachedCustomer) {
      setCustomerPhone(attachedCustomer.phone ?? '');
      setCustomerName(attachedCustomer.name);
    }
    setShowHeld(false);
    toast.success(`Resumed ${sale.heldKey}`);
  };

  const resetAfterSale = () => {
    clear();
    setCustomerPhone('');
    setCustomerName('');
    setCustomerResults([]);
    setAmountTendered('');
    setTenderPrompt(false);
    setAdjustmentInput('');
    setGiftCardCode('');
    setGiftCardBalance(null);
  };

  /**
   * Edit mode: the bill is already paid, so only the difference is settled and the
   * existing sale row is updated in place (no new receipt number is issued).
   */
  const handleUpdateBill = async (options?: { forcePrint?: boolean }) => {
    if (!editingSale || !items.length || processing) return;
    const isCash = editingSale.paymentMethod === 'cash';
    const received = isCash && amountToCollect > 0 ? parseFloat(amountTendered || '0') : amountToCollect;
    if (amountToCollect > 0 && received < amountToCollect) {
      toast.error(`Take at least PKR ${amountToCollect.toFixed(2)} from the customer before updating`);
      return;
    }

    if (billedItems.every((i) => i.billedQty === 0)) {
      toast.error(
        `Every item on ${editingSale.saleNumber} has been returned. Void the bill from `
        + 'Sales History instead — a bill cannot be saved with no items.',
      );
      return;
    }

    setProcessing(true);
    try {
    const result = await timeAsync('bill.update', () => api.sales.update({
      saleId: editingSale.id,
      // The billed quantity is sent, not the return marker: a line flipped to -1 is
      // charged as `originalQty - 1`, so the bill drops by the price once and stock
      // is credited with exactly the units handed back.
      items: billedItems.map((i) => ({
        productId: i.productId,
        quantity: i.billedQty,
        discountPercent: i.discountPercent,
        // Lines keep the price the bill was saved at (new lines carry today's price).
        unitPrice: i.unitPrice,
      })),
      ...saleCustomerPayload(customer, customerName, customerPhone),
      // Bill-level discount already nets promos and the manual adjustment, so the
      // stored total matches the figure the cashier just saw.
      discountAmount: subtotal - total,
      discountReason: [discountReason, promoCodeLabel ? `Promo ${promoCodeLabel}` : ''].filter(Boolean).join('; ') || undefined,
      // After settling, the shop holds exactly the new bill total — it either collected
      // the shortfall or handed the excess back — so that is what the bill records.
      amountTendered: isCash ? total : undefined,
    }));

    if (result.success && result.data) {
      const sale = result.data;
      const settled = netTotal;
      // The saved bill is the source of truth: if it does not match what the cashier
      // just approved, say so instead of reporting a success that did not happen.
      if (Math.abs(sale.totalAmount - Math.max(0, netTotal)) > 0.01) {
        toast.error(
          `Bill ${sale.saleNumber} saved as PKR ${sale.totalAmount.toFixed(2)}, not PKR ${Math.max(0, netTotal).toFixed(2)} — the return lines were rejected. Do not hand over cash; check the server version.`,
        );
        setProcessing(false);
        return;
      }
      // Pass the summary we already have so the print path doesn't re-fetch the sale.
      if (options?.forcePrint || autoPrintRef.current) void api.print.receipt(sale.id, sale);
      resetAfterSale();
      focusElement(searchRef, true);
      void refreshStockMap();
      toast.success(
        settled > 0.009
          ? `Bill ${sale.saleNumber} updated — take PKR ${settled.toFixed(2)} from the customer`
          : settled < -0.009
            ? `Bill ${sale.saleNumber} updated — give PKR ${Math.abs(settled).toFixed(2)} back to the customer`
            : `Bill ${sale.saleNumber} updated — no payment adjustment needed`,
      );
    } else {
      toast.error(result.error ?? 'Bill update failed');
    }
    } catch (err) {
      toast.error(
        `Bill may have been updated but the app hit an error: ${err instanceof Error ? err.message : 'unknown'}. Check Sales History.`,
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleCharge = async (options?: { forcePrint?: boolean }) => {
    if (editingSale) {
      await handleUpdateBill(options);
      return;
    }
    if (!items.length || processing) return;

    // Nothing typed yet: highlight the field and put the cursor in it rather than
    // failing with a toast the salesman has to read and dismiss.
    if (paymentMethod === 'cash' && total > 0.009 && !amountTendered.trim()) {
      setTenderPrompt(true);
      focusElement(tenderRef, true);
      return;
    }
    setProcessing(true);

    const tendered = paymentMethod === 'cash' ? parseFloat(amountTendered || '0') : total;
    if (paymentMethod === 'cash' && tendered < total) {
      toast.error('Insufficient amount tendered');
      setProcessing(false);
      return;
    }
    if (paymentMethod === 'wallet' && (!giftCardCode || giftCardBalance == null || giftCardBalance < total)) {
      toast.error('Invalid or insufficient gift card balance');
      setProcessing(false);
      return;
    }

    mark('charge.buttonToCartCleared');
    try {
    const result = await timeAsync('sale.save', () => api.sales.create({
      // unitPrice is sent so the sale records exactly the price shown in the cart —
      // a resumed hold keeps its saved prices even if the product was re-priced since.
      items: billedItems.map((i) => ({ productId: i.productId, quantity: i.billedQty, discountPercent: i.discountPercent, unitPrice: i.unitPrice })),
      ...saleCustomerPayload(customer, customerName, customerPhone),
      paymentMethod,
      amountTendered: paymentMethod === 'cash' ? tendered : undefined,
      discountAmount: (discountAmount + promoCodeDiscount) || undefined,
      discountReason: [discountReason, promoCodeLabel ? `Promo ${promoCodeLabel}` : ''].filter(Boolean).join('; ') || undefined,
      adjustmentAmount: adjustmentAmount || undefined,
      loyaltyPointsRedeemed: loyaltyPointsRedeemed || undefined,
      promotionIds: promotionIds.length ? promotionIds : undefined,
      giftCardCode: paymentMethod === 'wallet' ? giftCardCode : undefined,
      heldSaleId: heldSaleId ?? undefined,
    }));

    if (result.success && result.data) {
      const sale = result.data;
      const soldQty = billedItems.map((i) => ({ productId: i.productId, quantity: i.billedQty }));

      // Receipt first and unawaited — the sale is committed, so nothing here may
      // delay the printer or the cart clearing.
      if (options?.forcePrint || autoPrintRef.current) void api.print.receipt(sale.id, sale);

      resetAfterSale();
      measure('charge.buttonToCartCleared');
      focusElement(searchRef, true);

      // Bookkeeping only. A failure here must not look like a failed sale.
      try {
        if (promoCodeId) void api.promoCodes.redeem(promoCodeId);
        // We know exactly what was sold, so adjust the cached stock figures instead
        // of re-downloading the whole catalogue after every sale.
        applySoldToCatalogue(soldQty);
      } catch (err) {
        console.warn('[checkout] post-sale bookkeeping failed', err);
      }
    } else {
      toast.error(result.error ?? 'Sale failed');
    }
    } catch (err) {
      // The sale may well have been written — say so instead of silently hanging.
      toast.error(
        `Sale may have been saved but the app hit an error: ${err instanceof Error ? err.message : 'unknown'}. Check Sales History before retrying.`,
      );
    } finally {
      // Whatever happened, the button must never stay stuck on "Processing…".
      setProcessing(false);
    }
  };

  useEffect(() => { handleChargeRef.current = handleCharge; }, [handleCharge]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    return registerPageShortcuts('/checkout', {
      F1: () => setShowProductSearch(true),
      F2: () => handleHold(),
      F3: () => loadHeldSales(),
      F4: () => handleChargeRef.current(),
      'Ctrl+S': () => handleChargeRef.current({ forcePrint: true }),
      F5: () => focusElement(customerRef, true),
      F6: () => { if (paymentMethod === 'cash') focusElement(tenderRef, true); },
      Escape: () => {
        if (showHeld) setShowHeld(false);
        else if (items.length) setShowClearConfirm(true);
      },
    });
  }, [handleHold, loadHeldSales, showHeld, paymentMethod, items.length]);

  // The scanner buffer lives in a ref, not state: as state it was in this effect's
  // deps, so a 13-character scan re-rendered the page and swapped the window listener
  // 13 times. Nothing renders the buffer, so a ref is enough.
  useEffect(() => {
    const handleBarcode = (e: KeyboardEvent) => {
      if (getActiveRoute() !== '/checkout') return;
      if ([searchRef, customerRef, tenderRef].some((r) => r.current === document.activeElement)) return;
      if (showHeldRef.current) return;
      if (/^F\d{1,2}$/i.test(e.key) || e.key === 'Escape' || e.altKey) return;
      if (e.key === 'Enter' && barcodeBufferRef.current.length >= 4) {
        void lookupBarcodeRef.current(barcodeBufferRef.current);
        barcodeBufferRef.current = '';
        return;
      }
      if (e.key.length === 1 && /[0-9a-zA-Z]/.test(e.key)) {
        barcodeBufferRef.current += e.key;
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
        barcodeTimer.current = setTimeout(() => { barcodeBufferRef.current = ''; }, 100);
      }
    };
    window.addEventListener('keydown', handleBarcode);
    return () => window.removeEventListener('keydown', handleBarcode);
  }, []);

  // Latest-value refs for the scanner listener, which is registered once.
  useEffect(() => { lookupBarcodeRef.current = lookupBarcode; }, [lookupBarcode]);
  useEffect(() => { showHeldRef.current = showHeld; }, [showHeld]);

  const submitProductSearch = useCallback(async () => {
    const q = search.trim();
    if (!q) return;

    // Exact barcode/SKU wins, then the current result list — both from memory, so
    // pressing Enter no longer costs two requests.
    const exact = findCachedByBarcode(q);
    if (exact) {
      await addProductSafe(toProduct(exact));
      return;
    }

    let results = searchResults;
    if (!results.length && q.length >= 2) {
      results = searchCachedProducts(q).map(toProduct);
    }
    if (!results.length) {
      // Not in the cache — could be a product added on another till.
      const barcodeResult = await api.products.barcodeLookup(q);
      if (barcodeResult.success && barcodeResult.data) {
        await addProductSafe(barcodeResult.data);
        return;
      }
    }

    if (results.length === 1) {
      await addProductSafe(results[0]);
      return;
    }
    if (results.length > 1) {
      await addProductSafe(results[searchIndex]);
      return;
    }

    if (/^[0-9A-Za-z-]+$/.test(q) && q.length >= 4) {
      toast.error(`No product for barcode: ${q}`);
    }
  }, [search, searchResults, searchIndex, addProductSafe]);

  const handleSearch = (q: string) => {
    setSearch(q);
    setSearchIndex(0);
    if (q.length < 2) { setSearchResults([]); return; }
    // Searched against the in-memory catalogue — no debounce and no request needed.
    mark('search.product');
    setSearchResults(searchCachedProducts(q).map(toProduct));
    measure('search.product');
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && searchResults.length) {
      e.preventDefault();
      setSearchIndex((i) => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp' && searchResults.length) {
      e.preventDefault();
      setSearchIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void submitProductSearch();
    }
  };

  const lookupGiftCard = async (code: string) => {
    setGiftCardCode(code);
    if (code.length < 6) { setGiftCardBalance(null); return; }
    setGiftCardLoading(true);
    const result = await api.giftCards.lookup(code);
    setGiftCardLoading(false);
    if (result.success && result.data) setGiftCardBalance(result.data.currentBalance);
    else setGiftCardBalance(null);
  };

  const handleCustomerPhoneSearch = (phone: string) => {
    setCustomerPhone(phone);
    if (customerDebounce.current) clearTimeout(customerDebounce.current);
    if (phone.length < 3) { setCustomerResults([]); return; }
    customerDebounce.current = setTimeout(async () => {
      const result = await api.customers.search(phone);
      if (result.success) setCustomerResults(result.data ?? []);
    }, 250);
  };


  /**
   * Codes the salesman can pick from instead of typing one they have to remember.
   * Loaded on first open, not on mount, so it costs nothing on the scan path.
   * Listing is manager-only in both backends; a cashier simply keeps manual entry.
   */
  const openPromoList = useCallback(async () => {
    setShowPromoList((open) => !open);
    if (promoList !== null || promoListLoading) return;
    setPromoListLoading(true);
    const result = await api.promoCodes.list();
    setPromoListLoading(false);
    setPromoList(result.success && result.data ? result.data : []);
  }, [promoList, promoListLoading]);

  /** Why a code cannot be used right now — shown rather than hiding the code. */
  const promoBlockedReason = useCallback((promo: PromoCode): string | null => {
    const today = new Date().toISOString().slice(0, 10);
    if (!promo.isActive) return 'Inactive';
    if (promo.startDate && promo.startDate.slice(0, 10) > today) return 'Not started';
    if (promo.endDate && promo.endDate.slice(0, 10) < today) return 'Expired';
    if (promo.usageLimit != null && promo.usageCount >= promo.usageLimit) return 'Fully used';
    if (promo.minPurchase != null && subtotal < promo.minPurchase) {
      return `Needs PKR ${promo.minPurchase.toFixed(0)}`;
    }
    return null;
  }, [subtotal]);

  const promoValueLabel = (promo: PromoCode): string =>
    promo.type === 'percent' ? `${promo.value}% off` : `PKR ${promo.value.toFixed(0)} off`;

  const applyPromoCode = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed || !items.length) return;
    setPromoCodeApplying(true);
    const result = await api.promoCodes.validate({
      code: trimmed,
      subtotal: getSubtotal(),
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, categoryId: i.categoryId })),
    });
    setPromoCodeApplying(false);
    if (result.success && result.data) {
      setPromoCode(result.data.discountAmount, result.data.promoCodeId, result.data.code);
      setPromoCodeInput('');
      toast.success(`Promo ${result.data.code} applied — PKR ${result.data.discountAmount.toFixed(2)} off`);
    } else {
      toast.error(result.error ?? 'Invalid promo code');
    }
  }, [items, getSubtotal, setPromoCode]);

  const removePromoCode = () => {
    clearPromoCode();
    toast.info('Promo code removed');
  };

  // Re-validate an applied promo code whenever the cart changes so the discount stays correct.
  useEffect(() => {
    if (!promoCodeId || !promoCodeLabel) return;
    if (!items.length) { clearPromoCode(); return; }
    const timer = setTimeout(() => {
      api.promoCodes.validate({
        code: promoCodeLabel,
        subtotal: getSubtotal(),
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, categoryId: i.categoryId })),
      }).then((r) => {
        if (r.success && r.data) {
          if (Math.abs(r.data.discountAmount - promoCodeDiscount) > 0.01) {
            setPromoCode(r.data.discountAmount, r.data.promoCodeId, r.data.code);
          }
        } else {
          clearPromoCode();
          toast.info('Promo code no longer applies to this cart');
        }
      });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const handleAdjustmentChange = (v: string) => {
    setAdjustmentInput(v);
    const n = parseFloat(v);
    setAdjustment(Number.isFinite(n) ? n : 0);
  };

  return (
    <div className="h-full flex flex-col">
      {!isEditingBill && items.length === 0 && (
        <WorkflowStepper steps={WORKFLOW_STEPS} currentStep={workflowStep} />
      )}

      {editingSale && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <span className="font-semibold text-amber-900 dark:text-amber-200">Editing {editingSale.saleNumber}</span>
          <span
            className={cn(
              'ml-auto flex items-center gap-2 rounded-lg px-3 py-1 font-semibold',
              settlement.direction === 'refund'
                ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200'
                : settlement.direction === 'collect'
                  ? 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-200'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
            )}
          >
            {settlement.direction === 'settled'
              ? 'No difference'
              : `${settlement.icon} ${settlement.action} PKR ${settlement.amount.toFixed(2)}`}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setShowClearConfirm(true)}>Cancel</Button>
        </div>
      )}

      {productCount === 0 && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/50">
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200">No products in catalog</p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {isManager ? 'Add products in the Products tab' : 'Ask a manager to add products first'}
            </p>
          </div>
          {isManager && (
            <Button size="sm" variant="secondary" onClick={() => navigate('/products')}>Add Products</Button>
          )}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex w-[60%] min-h-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              Cart ({items.length})
              {heldSaleId && <span className="text-xs text-amber-600 ml-2">Resumed hold</span>}
            </h2>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowReceipts(true)}>View Receipts</Button>
              {!editingSale && (
                <Button variant="secondary" size="sm" onClick={handleHold} disabled={!items.length || processing}>Hold (F2)</Button>
              )}
              {!editingSale && (
                <Button variant="secondary" size="sm" onClick={loadHeldSales}>Resume (F3)</Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => items.length ? setShowClearConfirm(true) : clear()}>
                {editingSale ? 'Cancel (Esc)' : 'Clear (Esc)'}
              </Button>
            </div>
          </div>

          {/* Customer sits with the bill, not in the payment sidebar. Typing a name or
              phone is enough — the sale attaches or creates the customer on save. */}
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 dark:border-slate-800">
            <div className="relative w-56">
              <input
                ref={customerRef}
                type="tel"
                placeholder="Customer phone (F5)"
                value={customerPhone}
                onChange={(e) => handleCustomerPhoneSearch(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
              {customerResults.length > 0 && (
                <div className="absolute left-0 top-full z-30 mt-1 max-h-40 w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {customerResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-primary-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
                      onClick={() => {
                        setCustomer(c);
                        setCustomerPhone(c.phone ?? '');
                        setCustomerName(c.name);
                        setCustomerResults([]);
                        toast.info(`Customer: ${c.name}`);
                      }}
                    >
                      {c.name} · {c.phone ?? '—'} · {c.loyaltyPoints} pts
                    </button>
                  ))}
                </div>
              )}
            </div>
            <input
              type="text"
              placeholder="Customer name (optional)"
              value={customerName}
              onChange={(e) => { setCustomerName(e.target.value); if (customer) setCustomer(null); }}
              className="h-9 w-56 rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
            {customer && (
              <div className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-2 py-1 text-sm dark:border-primary-800 dark:bg-primary-950/40">
                <span className="text-primary-800 dark:text-primary-200">{customer.loyaltyPoints} pts</span>
                {!isEditingBill && (
                  <input
                    type="number"
                    placeholder="Redeem"
                    className="h-7 w-20 rounded border px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                    value={loyaltyPointsRedeemed || ''}
                    onChange={(e) => setLoyaltyRedemption(Math.min(parseInt(e.target.value, 10) || 0, customer.loyaltyPoints))}
                  />
                )}
                <button
                  type="button"
                  className="px-1 text-slate-400 hover:text-slate-600"
                  onClick={() => { setCustomer(null); setLoyaltyRedemption(0); }}
                  title="Unlink customer"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-100 text-2xl dark:bg-primary-950">🛒</div>
                <h3 className="mb-2 text-lg font-semibold text-slate-700 dark:text-slate-200">
                  {isEditingBill ? 'Bill is empty — add an item or cancel' : 'Start a sale'}
                </h3>
                <ol className={`max-w-xs space-y-2 text-left text-sm text-slate-500 dark:text-slate-400 ${isEditingBill ? 'hidden' : ''}`}>
                  <li><strong>1.</strong> Press <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">F1</kbd> and type a product name</li>
                  <li><strong>2.</strong> Or scan a barcode (scanner auto-adds)</li>
                  <li><strong>3.</strong> Press <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">F4</kbd> or <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">Ctrl+S</kbd> to charge</li>
                </ol>
                {productCount === 0 && isManager && (
                  <Button className="mt-4" variant="secondary" onClick={() => navigate('/products')}>Go to Products</Button>
                )}
              </div>
            ) : (
              <table className="w-full table-fixed">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90">
                  <tr className="text-left text-sm text-slate-500 dark:text-slate-400">
                    <th className="px-3 py-2 w-10">#</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 w-32">Qty</th>
                    <th className="px-3 py-2 w-16">Disc%</th>
                    <th className="px-3 py-2 w-24 text-right">Price</th>
                    <th className="px-3 py-2 w-28 text-right">Total</th>
                    <th className="px-3 py-2 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {cartItemsInScanOrder.map((item, index) => {
                    const onHand = getOnHandStock(item.productId);
                    const available = getAvailableStock(item.productId);
                    const lowStock = available > 0 && available <= 5;
                    const negativeStock = onHand < 0 || available < 0;
                    const isLatestScan = item.productId === lastScannedProductId;
                    return (
                      <tr
                        key={item.productId}
                        ref={isLatestScan ? latestCartRowRef : undefined}
                        className={cn(
                          'cursor-pointer border-t border-slate-100 transition-colors dark:border-slate-800',
                          isLatestScan
                            ? 'bg-primary-50 hover:bg-primary-100/80 dark:bg-primary-950/50 dark:hover:bg-primary-950/70 ring-1 ring-inset ring-primary-200 dark:ring-primary-800'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                        )}
                        title="Double-click for product history"
                        onDoubleClick={() => setHistoryProduct({ id: item.productId, name: item.productName })}
                      >
                        <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400 font-medium tabular-nums">{index + 1}</td>
                        <td className="px-3 py-1.5">
                          {/* One line each for name and identity: three stacked lines per
                              row meant only four products fitted on screen at once. */}
                          <div className="truncate font-medium text-slate-900 dark:text-slate-100" title={item.productName}>
                            {item.productName}
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="truncate text-slate-400">{item.productSku}</span>
                            {/* Stock is only worth the space when it is a problem. */}
                            {negativeStock ? (
                              <span className="shrink-0 font-medium text-red-600">
                                Stock {available} ({onHand} on hand)
                              </span>
                            ) : available <= 0 ? (
                              <span className="shrink-0 font-medium text-amber-600">
                                Last one ({onHand} on hand)
                              </span>
                            ) : lowStock ? (
                              <span className="shrink-0 font-medium text-amber-600">Only {available} left</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-1.5" onDoubleClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <button type="button" className="h-9 w-9 shrink-0 rounded bg-slate-100 text-lg font-bold leading-none dark:bg-slate-800 dark:text-slate-100" onClick={() => stepQuantity(item.productId, item.quantity, -1)}>-</button>
                            <input
                              type="text"
                              inputMode="numeric"
                              aria-label={`Quantity for ${item.productName}`}
                              value={qtyDraft?.productId === item.productId ? qtyDraft.value : String(item.quantity)}
                              onChange={(e) => setQtyDraft({ productId: item.productId, value: e.target.value })}
                              onFocus={(e) => {
                                setQtyDraft({ productId: item.productId, value: String(item.quantity) });
                                e.target.select();
                              }}
                              onBlur={() => commitQtyDraft(item.productId, item.quantity)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                                else if (e.key === 'Escape') { setQtyDraft(null); e.currentTarget.blur(); }
                                else if (e.key === 'ArrowUp') { e.preventDefault(); setQtyDraft(null); stepQuantity(item.productId, item.quantity, 1); }
                                else if (e.key === 'ArrowDown') { e.preventDefault(); setQtyDraft(null); stepQuantity(item.productId, item.quantity, -1); }
                              }}
                              className={cn(
                                'h-9 w-12 shrink-0 rounded border border-slate-200 text-center font-medium tabular-nums dark:border-slate-700 dark:bg-slate-900',
                                item.quantity < 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100',
                              )}
                            />
                            <button
                              type="button"
                              className="h-9 w-9 shrink-0 rounded bg-slate-100 text-lg font-bold leading-none dark:bg-slate-800 dark:text-slate-100"
                              onClick={() => stepQuantity(item.productId, item.quantity, 1)}
                            >+</button>
                          </div>
                          {item.quantity < 0 && (
                            <div className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                              {Math.abs(item.quantity)} returned
                              {isEditingBill
                                ? item.billedQty === 0
                                  ? ' — off the bill'
                                  : ` — billing ${item.billedQty}`
                                : ''}
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          <input
                            type="number" min={0} max={100}
                            value={item.discountPercent || ''}
                            onChange={(e) => updateLineDiscount(item.productId, parseFloat(e.target.value) || 0)}
                            className="h-9 w-14 rounded border px-1 text-center text-sm dark:border-slate-700 dark:bg-slate-900"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{item.unitPrice.toFixed(2)}</td>
                        <td className={cn(
                          'px-3 py-1.5 text-right font-semibold tabular-nums',
                          item.displayLineTotal < 0 && 'text-red-600 dark:text-red-400',
                        )}>
                          {item.displayLineTotal.toFixed(2)}
                        </td>
                        <td className="px-3 py-1.5">
                          <button type="button" className="px-1 text-lg leading-none text-red-500" onClick={() => removeItem(item.productId)}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="space-y-1 border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/80">
            <div className="flex justify-between text-sm text-slate-700 dark:text-slate-300">
              <span>{isEditingBill ? 'Bill now (items kept)' : 'Subtotal'}</span>
              <span>PKR {subtotal.toFixed(2)}</span>
            </div>
            {discountAmount !== 0 && (
              <div className={`flex justify-between text-sm ${discountAmount > 0 ? 'text-green-700' : 'text-amber-700'}`}>
                <span>
                  {editingSale
                    ? discountReason || (discountAmount > 0 ? 'Saved bill discount' : 'Saved bill surcharge')
                    : `Promo${appliedPromos.length ? `: ${appliedPromos.join(', ')}` : ''}`}
                </span>
                <span>{discountAmount > 0 ? '-' : '+'} PKR {Math.abs(discountAmount).toFixed(2)}</span>
              </div>
            )}
            {promoCodeDiscount > 0 && (
              <div className="flex justify-between text-sm text-green-700">
                <span>
                  Promo code{promoCodeLabel ? `: ${promoCodeLabel}` : ''}
                  <button type="button" className="ml-2 text-red-500" onClick={removePromoCode}>×</button>
                </span>
                <span>- PKR {promoCodeDiscount.toFixed(2)}</span>
              </div>
            )}
            {loyaltyDiscount > 0 && (
              <div className="flex justify-between text-sm text-green-700">
                <span>Loyalty ({loyaltyPointsRedeemed} pts)</span>
                <span>- PKR {loyaltyDiscount.toFixed(2)}</span>
              </div>
            )}
            {adjustmentAmount !== 0 && (
              <div className={`flex justify-between text-sm ${adjustmentAmount < 0 ? 'text-green-700' : 'text-amber-700'}`}>
                <span>{adjustmentAmount < 0 ? 'Discount adjustment' : 'Surcharge'}</span>
                <span>{adjustmentAmount < 0 ? '-' : '+'} PKR {Math.abs(adjustmentAmount).toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t pt-2 dark:border-slate-700">
              <div>
                <span className={cn(
                  'text-xl font-bold',
                  isEditingBill && settlementDelta < -0.009
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-primary-700 dark:text-primary-400',
                )}>
                  Total
                </span>
                <span className="ml-2 text-xs text-slate-400">
                  {cartItemCount} item{cartItemCount === 1 ? '' : 's'}
                  {/* On a paid bill the headline figure is the money that actually moves,
                      so a refund reads as a negative rather than as a sum to collect. */}
                  {isEditingBill && ` · bill ${total.toFixed(2)} less ${alreadyPaid.toFixed(2)} paid`}
                </span>
              </div>
              <span className={cn(
                'text-3xl font-bold tabular-nums',
                isEditingBill && settlementDelta < -0.009
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-primary-700 dark:text-primary-400',
              )}>
                PKR {isEditingBill
                  ? `${settlementDelta < 0 ? '−' : ''}${Math.abs(settlementDelta).toFixed(2)}`
                  : total.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex w-[40%] min-h-0 flex-col bg-slate-50 dark:bg-slate-900/50">
          {/* The steps scroll; the charge button below never does. On a shorter screen
              the panel used to run past the bottom and take the charge button with it. */}
          <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="border-b border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Step 1 — Find product (F1)</label>
            <input
              ref={searchRef}
              type="text"
              placeholder="Type 2+ letters or scan barcode…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="mt-2 w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-4 text-xl font-medium text-slate-900 shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            {search.length > 0 && search.length < 2 && (
              <p className="text-xs text-slate-400 mt-1">Type at least 2 characters…</p>
            )}
            {searchResults.length > 0 && (
              <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                {searchResults.map((p, idx) => {
                  const available = getAvailableStock(p.id, p.stockQty);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`w-full border-b border-slate-100 px-4 py-3 text-left last:border-0 dark:border-slate-800 ${idx === searchIndex ? 'bg-primary-100 dark:bg-primary-950' : 'hover:bg-primary-50 dark:hover:bg-slate-800'}`}
                      onClick={() => { void addProductSafe(p); }}
                      onMouseEnter={() => setSearchIndex(idx)}
                    >
                      <div className="font-medium text-slate-900 dark:text-slate-100">{p.name}</div>
                      <div className="text-sm text-slate-500 flex justify-between">
                        <span>PKR {(p.salePrice ?? p.retailPrice).toFixed(2)}</span>
                        <span className={available < 0 ? 'text-red-600 font-medium' : available <= 0 ? 'text-amber-600 font-medium' : available <= 5 ? 'text-amber-600' : ''}>
                          {available < 0 ? `Available: ${available}` : available === 0 ? 'No stock on hand' : `Available: ${available}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
                <p className="text-xs text-slate-400 px-4 py-2">↑↓ navigate · Enter to add</p>
              </div>
            )}
            {search.length >= 2 && searchResults.length === 0 && (
              <p className="text-sm text-slate-500 mt-2">No products found — try another term or load demo data</p>
            )}
          </div>

          {isEditingBill && (
            <div className="border-b border-slate-200 p-4 dark:border-slate-800">
              <div className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
                {/* The two figures the settlement is derived from, so the salesman can
                    see why money is going back rather than being asked for. */}
                <div className="flex justify-between">
                  <span>Bill now (items kept)</span>
                  <span className="tabular-nums">{total.toFixed(2)}</span>
                </div>
                {returnTotal > 0.009 && (
                  <div className="flex justify-between text-red-600 dark:text-red-400">
                    <span>Returned</span><span className="tabular-nums">−{returnTotal.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Customer already paid</span>
                  <span className="tabular-nums">{alreadyPaid.toFixed(2)}</span>
                </div>
              </div>
              {settlement.direction === 'settled' ? (
                <div className="mt-2 border-t pt-2 text-sm text-slate-500 dark:border-slate-700">Nothing to pay or refund</div>
              ) : (
                <div
                  className={cn(
                    'mt-2 flex items-baseline justify-between border-t pt-2 dark:border-slate-700',
                    settlement.direction === 'refund'
                      ? 'text-red-700 dark:text-red-300'
                      : 'text-green-700 dark:text-green-300',
                  )}
                >
                  <span className="text-sm font-semibold">{settlement.icon} {settlement.action}</span>
                  <span className="text-2xl font-bold tabular-nums">{settlement.amount.toFixed(2)}</span>
                </div>
              )}
              {amountToCollect > 0.009 && editingSale!.paymentMethod === 'cash' && (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    ref={tenderRef}
                    type="number"
                    value={amountTendered}
                    onChange={(e) => setAmountTendered(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-4 py-3 text-xl font-bold dark:border-slate-700 dark:bg-slate-900"
                    placeholder={`Received (${amountToCollect.toFixed(2)})`}
                  />
                  <Button size="sm" variant="secondary" onClick={() => setAmountTendered(amountToCollect.toFixed(2))}>Exact</Button>
                </div>
              )}
              {editCashChange > 0 && (
                <p className="mt-2 text-sm font-semibold text-green-700">Change PKR {editCashChange.toFixed(2)}</p>
              )}
            </div>
          )}

          {/* Discounts live beside the cart rather than inside the running total, so the
              money summary stays a summary and these stay one click away. */}
          <div className={`border-b border-slate-200 p-4 dark:border-slate-800 ${isEditingBill ? 'hidden' : ''}`}>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Step 2 — Discounts (optional)
            </label>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={promoCodeInput}
                onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') applyPromoCode(promoCodeInput); }}
                placeholder="Promo code"
                disabled={!items.length}
                className="h-11 flex-1 rounded-lg border border-slate-200 px-3 font-mono text-sm uppercase disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
              />
              <Button
                variant="secondary"
                onClick={() => void openPromoList()}
                disabled={!items.length}
                title="Show available promo codes"
              >
                {showPromoList ? 'Hide' : 'Choose'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => applyPromoCode(promoCodeInput)}
                disabled={!items.length || !promoCodeInput.trim() || promoCodeApplying}
              >
                {promoCodeApplying ? '…' : 'Apply'}
              </Button>
            </div>

            {showPromoList && (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                {promoListLoading && (
                  <p className="px-3 py-3 text-sm text-slate-400">Loading codes…</p>
                )}
                {!promoListLoading && promoList?.length === 0 && (
                  <p className="px-3 py-3 text-sm text-slate-400">
                    No promo codes available to pick — type one instead.
                  </p>
                )}
                {!promoListLoading && promoList?.map((promo) => {
                  const blocked = promoBlockedReason(promo);
                  return (
                    <button
                      key={promo.id}
                      type="button"
                      disabled={!!blocked || promoCodeApplying}
                      onClick={() => { setShowPromoList(false); void applyPromoCode(promo.code); }}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 border-b px-3 py-2.5 text-left last:border-b-0 dark:border-slate-800',
                        blocked
                          ? 'cursor-not-allowed opacity-60'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {promo.code}
                        </span>
                        {promo.description && (
                          <span className="block truncate text-xs text-slate-400">{promo.description}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold text-green-700 dark:text-green-400">
                          {promoValueLabel(promo)}
                        </span>
                        {/* Say why it cannot be used — a greyed row with no reason is a puzzle. */}
                        {blocked && <span className="block text-xs text-amber-600">{blocked}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {promoCodeDiscount > 0 && (
              <p className="mt-1 text-xs font-medium text-green-700">
                {promoCodeLabel || 'Promo'} applied — PKR {promoCodeDiscount.toFixed(2)} off
                <button type="button" className="ml-2 text-red-500" onClick={removePromoCode}>Remove</button>
              </p>
            )}

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-xs text-slate-500 dark:text-slate-400">
                Discount on every item (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={globalDiscountPercent || ''}
                  onChange={(e) => setGlobalDiscount(parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  disabled={!items.length}
                  className="mt-1 h-11 w-full rounded-lg border border-slate-200 px-3 text-right text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
                />
              </label>
              <label className="block text-xs text-slate-500 dark:text-slate-400">
                Adjust bill (+/- PKR)
                <input
                  type="number"
                  value={adjustmentInput}
                  onChange={(e) => handleAdjustmentChange(e.target.value)}
                  placeholder="0"
                  className="mt-1 h-11 w-full rounded-lg border border-slate-200 px-3 text-right text-sm dark:border-slate-700 dark:bg-slate-900"
                />
              </label>
            </div>
          </div>

          <div className={`border-b border-slate-200 p-4 dark:border-slate-800 ${isEditingBill ? 'hidden' : ''}`}>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Step 3 — Payment</label>
            <div className="flex gap-2">
              {(['cash', 'card', 'online', 'wallet'] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setPaymentMethod(m); setTenderPrompt(false); }}
                  className={`min-h-[44px] flex-1 rounded-lg py-2.5 text-xs font-medium capitalize ${
                    paymentMethod === m
                      ? 'bg-primary-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  {m === 'wallet' ? 'Gift Card' : m === 'online' ? 'Online' : m.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {!isEditingBill && paymentMethod === 'wallet' && (
            <div className="p-4 border-b border-slate-200">
              <input
                value={giftCardCode}
                onChange={(e) => lookupGiftCard(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 rounded-lg border border-slate-200 font-mono"
                placeholder="GC-XXXXXXXXXX"
              />
              {giftCardLoading && <p className="text-xs text-slate-400 mt-1">Checking balance…</p>}
              {giftCardBalance != null && (
                <p className={`mt-2 text-sm font-medium ${giftCardBalance >= total ? 'text-green-700' : 'text-red-600'}`}>
                  Balance: PKR {giftCardBalance.toFixed(2)}
                </p>
              )}
            </div>
          )}

          {!isEditingBill && paymentMethod === 'cash' && (
            <div className="border-b border-slate-200 p-4 dark:border-slate-800">
              <label
                htmlFor="amount-tendered"
                className={cn(
                  'text-sm font-medium',
                  tenderPrompt ? 'text-amber-700 dark:text-amber-400' : 'text-slate-600 dark:text-slate-400',
                )}
              >
                Amount tendered (F6)
              </label>
              <input
                id="amount-tendered"
                ref={tenderRef}
                type="number"
                value={amountTendered}
                aria-invalid={tenderPrompt}
                onChange={(e) => { setAmountTendered(e.target.value); if (tenderPrompt) setTenderPrompt(false); }}
                className={cn(
                  'mt-1 w-full rounded-lg border px-4 py-3 text-xl font-bold outline-none transition-colors dark:bg-slate-900',
                  tenderPrompt
                    ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-300 dark:border-amber-600 dark:bg-amber-950/30 dark:ring-amber-900'
                    : 'border-slate-200 dark:border-slate-700',
                )}
                placeholder="0.00"
              />
              {tenderPrompt && (
                <p className="mt-1 text-sm font-medium text-amber-700 dark:text-amber-400">
                  Enter the amount received
                </p>
              )}
              {change > 0 && (
                <div className="mt-3 rounded-xl border-2 border-green-300 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/40">
                  <div className="text-xs font-bold uppercase tracking-wide text-green-700 dark:text-green-300">
                    Give change
                  </div>
                  <div className="text-3xl font-bold tabular-nums text-green-700 dark:text-green-300">
                    PKR {change.toFixed(2)}
                  </div>
                </div>
              )}
              {tenderShort && (
                <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
                  Short by PKR {(total - parseFloat(amountTendered || '0')).toFixed(2)}
                </p>
              )}
            </div>
          )}

          {!isEditingBill && (paymentMethod === 'card' || paymentMethod === 'online') && (
            <div className="border-b border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
              {paymentMethod === 'online' ? 'Online payment' : 'Card payment'} — press <strong>F4</strong> to charge PKR {total.toFixed(2)}
            </div>
          )}

          </div>

          <div className="border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/50">
            <Button
              size="lg"
              // Money leaving the till gets the danger colour, so the direction reads
              // off the button itself and not just the label.
              variant={isEditingBill && settlement.direction === 'refund' ? 'danger' : 'primary'}
              className="w-full text-xl py-4"
              onClick={() => handleCharge()}
              disabled={
                processing || items.length === 0 ||
                (!isEditingBill && paymentMethod === 'wallet' && (!giftCardCode || (giftCardBalance != null && giftCardBalance < total)))
              }
            >
              {processing
                ? 'Processing…'
                : items.length === 0
                  ? isEditingBill ? 'Bill needs at least one item' : 'Add products first'
                  : isEditingBill
                    ? settlement.direction === 'settled'
                      ? 'Update bill (F4)'
                      : `Update & ${settlement.short.toLowerCase()} PKR ${settlement.amount.toFixed(2)} (F4)`
                    : `Charge PKR ${total.toFixed(2)} (F4 / Ctrl+S)`}
            </Button>
          </div>
        </div>
      </div>

      <Modal open={showClearConfirm} title={isEditingBill ? 'Cancel bill edit?' : 'Clear cart?'} onClose={() => setShowClearConfirm(false)}
        footer={
          <ModalActions
            onCancel={() => setShowClearConfirm(false)}
            onConfirm={() => {
              clear();
              setCustomerPhone('');
              setCustomerName('');
              setCustomerResults([]);
              setAmountTendered('');
              setGiftCardCode('');
              setGiftCardBalance(null);
              setShowClearConfirm(false);
              toast.info(isEditingBill ? 'Bill edit cancelled — no changes saved' : 'Cart cleared');
            }}
            confirmLabel="Clear cart"
            confirmVariant="danger"
          />
        }
      >
        <p className="text-slate-600">
          {isEditingBill
            ? `Discard changes to ${editingSale!.saleNumber}?`
            : `Remove all ${items.length} item(s) from the cart?`}
        </p>
      </Modal>

      <Modal open={showHeld} title="Resume held sale (F3)" onClose={() => setShowHeld(false)}>
        {heldSales.length === 0 ? (
          <div className="text-center py-6 text-slate-500">
            <p>No held sales</p>
            <p className="text-sm mt-2">Press <strong>F2</strong> during checkout to hold a sale for later</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {heldSales.map((s) => (
              <div key={s.id} className="flex gap-2 items-center p-3 border rounded-lg">
                <button type="button" onClick={() => handleResume(s)} className="flex-1 text-left hover:bg-primary-50 rounded p-1">
                  <div className="font-medium">{s.heldKey}</div>
                  <div className="text-sm text-slate-500">{s.items.length} items — PKR {s.totalAmount.toFixed(2)}</div>
                </button>
                <Button variant="danger" size="sm" onClick={() => handleDiscardHeld(s.id)}>Discard</Button>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <ProductHistoryModal
        open={!!historyProduct}
        productId={historyProduct?.id ?? null}
        productName={historyProduct?.name ?? ''}
        onClose={() => setHistoryProduct(null)}
      />

      <ProductSearchModal
        open={showProductSearch}
        onClose={() => setShowProductSearch(false)}
        onSelect={(p) => { void addProductSafe(p); }}
        getAvailableStock={(productId, fallback) => getAvailableStock(productId, fallback)}
      />
      <ReceiptSearchModal open={showReceipts} onClose={() => setShowReceipts(false)} />

      <Modal
        open={!!stockWarning}
        title="Warning: Out of stock"
        priority="alert"
        onClose={() => setStockWarning(null)}
        footer={<Button autoFocus onClick={() => setStockWarning(null)}>OK, continue</Button>}
      >
        <p className="text-slate-700">
          Warning: Inventory is not available for this product. Current stock is {stockWarning?.stock ?? 0}.
          Continuing with this sale will result in negative inventory.
        </p>
        {stockWarning && (
          <p className="text-sm text-slate-500 mt-2">Product: <strong>{stockWarning.productName}</strong></p>
        )}
      </Modal>
    </div>
  );
}
