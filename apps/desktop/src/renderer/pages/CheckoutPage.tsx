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
import type { Customer, Product, SaleSummary, SearchProduct } from '@shared/types';
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
    getSubtotal, getTotal,
  } = useCartStore();

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [productCount, setProductCount] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountTendered, setAmountTendered] = useState('');
  const [adjustmentInput, setAdjustmentInput] = useState('');
  const [taxInclusive] = useState(true);
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
  const [giftCardCode, setGiftCardCode] = useState('');
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
  const [giftCardLoading, setGiftCardLoading] = useState(false);
  const [secondaryCurrency, setSecondaryCurrency] = useState('');
  const [exchangeRate, setExchangeRate] = useState(0);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [stockWarning, setStockWarning] = useState<{ productName: string; stock: number } | null>(null);
  const [historyProduct, setHistoryProduct] = useState<{ id: string; name: string } | null>(null);
  const latestCartRowRef = useRef<HTMLTableRowElement | null>(null);

  const cartItemsInScanOrder = useMemo(
    () => [...items].sort((a, b) => (a.scannedAt ?? 0) - (b.scannedAt ?? 0)),
    [items],
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
  /** One reduce per cart change instead of the store getter re-running each render. */
  const subtotal = useMemo(() => items.reduce((sum, i) => sum + i.lineTotal, 0), [items]);
  const total = getTotal(taxInclusive) - loyaltyDiscount;
  /** Edit mode: what still has to move between cashier and customer. >0 collect, <0 refund. */
  const billDifference = editingSale ? total - editingSale.originalTotal : 0;
  const amountToCollect = Math.max(0, billDifference);
  const amountToRefund = Math.max(0, -billDifference);
  const editCashChange = isEditingBill
    ? Math.max(0, parseFloat(amountTendered || '0') - amountToCollect)
    : 0;
  const change = isEditingBill
    ? editCashChange
    : paymentMethod === 'cash' ? Math.max(0, parseFloat(amountTendered || '0') - total) : 0;
  const secondaryTotal = exchangeRate > 0 && secondaryCurrency ? total * exchangeRate : null;

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
    for (const i of items) map.set(i.productId, (map.get(i.productId) ?? 0) + i.quantity);
    return map;
  }, [items]);

  const getAvailableStock = useCallback((productId: string, fallbackOnHand = 0) => (
    getOnHandStock(productId, fallbackOnHand) - (cartQtyById.get(productId) ?? 0)
  ), [getOnHandStock, cartQtyById]);

  useEffect(() => {
    api.customers.loyaltyRules().then((r) => {
      if (r.success && r.data?.[0]) setRedemptionRate(r.data[0].redemptionRate);
    });
    // One settings read covers currency, exchange rate and the auto-print flag;
    // the charge path used to fetch auto_print_receipt again on every sale.
    api.settings.getAll().then((r) => {
      if (r.success && r.data) {
        setSecondaryCurrency(r.data.secondary_currency ?? '');
        setExchangeRate(parseFloat(r.data.exchange_rate ?? '0') || 0);
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
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, discountPercent: i.discountPercent, unitPrice: i.unitPrice })),
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
      toast.error(`Collect at least PKR ${amountToCollect.toFixed(2)} before updating`);
      return;
    }

    setProcessing(true);
    try {
    const result = await timeAsync('bill.update', () => api.sales.update({
      saleId: editingSale.id,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        discountPercent: i.discountPercent,
        // Lines keep the price the bill was saved at (new lines carry today's price).
        unitPrice: i.unitPrice,
      })),
      ...saleCustomerPayload(customer, customerName, customerPhone),
      // Bill-level discount already nets promos and the manual adjustment, so the
      // stored total matches the figure the cashier just saw.
      discountAmount: subtotal - total,
      discountReason: [discountReason, promoCodeLabel ? `Promo ${promoCodeLabel}` : ''].filter(Boolean).join('; ') || undefined,
      // Cash bills track the running total actually paid, so the stored change/refund
      // stays correct after the edit. Non-cash bills keep whatever they had.
      amountTendered: isCash ? editingSale.netPaid + received : undefined,
    }));

    if (result.success && result.data) {
      const sale = result.data;
      const settled = sale.totalAmount - editingSale.originalTotal;
      // Pass the summary we already have so the print path doesn't re-fetch the sale.
      if (options?.forcePrint || autoPrintRef.current) void api.print.receipt(sale.id, sale);
      resetAfterSale();
      focusElement(searchRef, true);
      void refreshStockMap();
      toast.success(
        settled > 0.009
          ? `Bill ${sale.saleNumber} updated — collected PKR ${settled.toFixed(2)}`
          : settled < -0.009
            ? `Bill ${sale.saleNumber} updated — refund PKR ${Math.abs(settled).toFixed(2)}`
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
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, discountPercent: i.discountPercent, unitPrice: i.unitPrice })),
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
      const soldQty = items.map((i) => ({ productId: i.productId, quantity: i.quantity }));

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

  const handleQuickAddCustomer = async () => {
    if (!customerName.trim()) { toast.warning('Enter customer name'); return; }
    const result = await api.customers.create({ name: customerName.trim(), phone: customerPhone || undefined });
    if (result.success && result.data) {
      setCustomer(result.data);
      setCustomerName(result.data.name);
      setCustomerPhone(result.data.phone ?? '');
      toast.success(`Customer: ${result.data.name}`);
      setCustomerResults([]);
    } else toast.error(result.error ?? 'Could not add customer');
  };

  const setExactCash = () => setAmountTendered(total.toFixed(2));

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
      {!isEditingBill && <WorkflowStepper steps={WORKFLOW_STEPS} currentStep={workflowStep} />}

      {editingSale && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <span className="font-semibold text-amber-900 dark:text-amber-200">Editing {editingSale.saleNumber}</span>
          <span className="text-amber-700 dark:text-amber-300">Saved PKR {editingSale.originalTotal.toFixed(2)}</span>
          <span className="ml-auto font-semibold text-amber-900 dark:text-amber-200">
            {amountToCollect > 0.009
              ? `Collect PKR ${amountToCollect.toFixed(2)}`
              : amountToRefund > 0.009
                ? `Refund PKR ${amountToRefund.toFixed(2)}`
                : 'No difference'}
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
        <div className="flex w-[60%] flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
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
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90">
                  <tr className="text-left text-sm text-slate-500 dark:text-slate-400">
                    <th className="p-3 w-12">SR No.</th>
                    <th className="p-3">Product</th>
                    <th className="p-3 w-28">Qty</th>
                    <th className="p-3 w-16">Disc%</th>
                    <th className="p-3 w-24 text-right">Price</th>
                    <th className="p-3 w-28 text-right">Total</th>
                    <th className="p-3 w-16" />
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
                        <td className="p-3 text-slate-500 dark:text-slate-400 font-medium tabular-nums">{index + 1}</td>
                        <td className="p-3">
                          <div className="font-medium text-slate-900 dark:text-slate-100">{item.productName}</div>
                          <div className="text-xs text-slate-400">{item.productSku}</div>
                          <div className={`text-xs mt-0.5 font-medium ${negativeStock ? 'text-red-600' : available <= 0 ? 'text-amber-600' : lowStock ? 'text-amber-600' : 'text-green-700'}`}>
                            Available: {available} <span className="text-slate-400 font-normal">({onHand} on hand)</span>
                          </div>
                        </td>
                        <td className="p-3" onDoubleClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <button type="button" className="h-10 w-10 rounded bg-slate-100 font-bold dark:bg-slate-800 dark:text-slate-100" onClick={() => updateQuantity(item.productId, item.quantity - 1)}>-</button>
                            <span className="w-8 text-center font-medium text-slate-900 dark:text-slate-100">{item.quantity}</span>
                            <button
                              type="button"
                              className="h-10 w-10 rounded bg-slate-100 font-bold dark:bg-slate-800 dark:text-slate-100"
                              onClick={() => {
                                const nextAvailable = onHand - item.quantity - 1;
                                updateQuantity(item.productId, item.quantity + 1);
                                if (nextAvailable < 0) {
                                  setStockWarning({ productName: item.productName, stock: onHand });
                                }
                              }}
                            >+</button>
                          </div>
                        </td>
                        <td className="p-3">
                          <input
                            type="number" min={0} max={100}
                            value={item.discountPercent || ''}
                            onChange={(e) => updateLineDiscount(item.productId, parseFloat(e.target.value) || 0)}
                            className="w-14 px-1 py-1 border rounded text-sm text-center"
                          />
                        </td>
                        <td className="p-3 text-right">{item.unitPrice.toFixed(2)}</td>
                        <td className="p-3 text-right font-semibold">{item.lineTotal.toFixed(2)}</td>
                        <td className="p-3">
                          <button type="button" className="text-red-500 text-sm" onClick={() => removeItem(item.productId)}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="space-y-1 border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/80">
            <div className="flex justify-between text-sm text-slate-700 dark:text-slate-300"><span>Subtotal</span><span>PKR {subtotal.toFixed(2)}</span></div>
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
            <div className={`flex items-center gap-2 pt-1 ${isEditingBill ? 'hidden' : ''}`}>
              <input
                type="text"
                value={promoCodeInput}
                onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === 'Enter') applyPromoCode(promoCodeInput); }}
                placeholder="Promo code"
                disabled={!items.length}
                className="flex-1 rounded border border-slate-200 px-2 py-1 text-sm font-mono uppercase disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => applyPromoCode(promoCodeInput)}
                disabled={!items.length || !promoCodeInput.trim() || promoCodeApplying}
              >
                {promoCodeApplying ? '…' : 'Apply'}
              </Button>
            </div>
            {loyaltyDiscount > 0 && (
              <div className="flex justify-between text-sm text-green-700">
                <span>Loyalty ({loyaltyPointsRedeemed} pts)</span>
                <span>- PKR {loyaltyDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 pt-1 text-sm text-slate-700 dark:text-slate-300">
              <span title="Applies this discount % to every scanned item">Global discount (%)</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={globalDiscountPercent || ''}
                  onChange={(e) => setGlobalDiscount(parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  disabled={!items.length}
                  className="w-24 rounded border border-slate-200 px-2 py-1 text-right text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
                />
                <span className="text-xs text-slate-400">%</span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1 text-sm text-slate-700 dark:text-slate-300">
              <span title="Positive adds a surcharge, negative gives an extra discount">Adjustment (+/-)</span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400">PKR</span>
                <input
                  type="number"
                  value={adjustmentInput}
                  onChange={(e) => handleAdjustmentChange(e.target.value)}
                  placeholder="0"
                  className="w-24 rounded border border-slate-200 px-2 py-1 text-right text-sm dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
            </div>
            {adjustmentAmount !== 0 && (
              <div className={`flex justify-between text-sm ${adjustmentAmount < 0 ? 'text-green-700' : 'text-amber-700'}`}>
                <span>{adjustmentAmount < 0 ? 'Discount adjustment' : 'Surcharge'}</span>
                <span>{adjustmentAmount < 0 ? '-' : '+'} PKR {Math.abs(adjustmentAmount).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-2 text-xl font-bold text-primary-700 dark:border-slate-700 dark:text-primary-400">
              <span>Total</span><span>PKR {total.toFixed(2)}</span>
            </div>
            {secondaryTotal != null && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>≈ {secondaryCurrency}</span><span>{secondaryTotal.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex w-[40%] flex-col bg-slate-50 dark:bg-slate-900/50">
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

          <div className="space-y-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Customer (optional, F5)</label>
            <input
              ref={customerRef}
              type="tel"
              placeholder="Phone (03XX-XXXXXXX)"
              value={customerPhone}
              onChange={(e) => handleCustomerPhoneSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
            />
            {customerResults.length > 0 && (
              <div className="max-h-24 overflow-y-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
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
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Customer name"
                value={customerName}
                onChange={(e) => { setCustomerName(e.target.value); if (customer) setCustomer(null); }}
                className="flex-1 px-3 py-2 rounded-lg border text-sm"
              />
              {!customer && (
                <Button size="sm" variant="secondary" onClick={handleQuickAddCustomer}>Add</Button>
              )}
            </div>
            {customer && (
              <div className="flex items-center justify-between text-sm bg-primary-50 p-2 rounded-lg border border-primary-200">
                <span>Linked · {customer.loyaltyPoints} loyalty pts</span>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    placeholder="Redeem pts"
                    hidden={isEditingBill}
                    className="w-20 px-2 py-1 border rounded text-xs"
                    value={loyaltyPointsRedeemed || ''}
                    onChange={(e) => setLoyaltyRedemption(Math.min(parseInt(e.target.value, 10) || 0, customer.loyaltyPoints))}
                  />
                  <button type="button" className="text-slate-400" onClick={() => { setCustomer(null); setLoyaltyRedemption(0); }}>×</button>
                </div>
              </div>
            )}
          </div>

          {isEditingBill && (
            <div className="border-b border-slate-200 p-4 dark:border-slate-800">
              <div className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
                <div className="flex justify-between"><span>Saved</span><span className="tabular-nums">PKR {editingSale!.originalTotal.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Now</span><span className="tabular-nums">PKR {total.toFixed(2)}</span></div>
              </div>
              {amountToCollect > 0.009 || amountToRefund > 0.009 ? (
                <div className={`mt-2 flex items-baseline justify-between border-t pt-2 dark:border-slate-700 ${amountToRefund > 0.009 ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-200'}`}>
                  <span className="text-sm font-medium">{amountToRefund > 0.009 ? 'Refund' : 'Collect'}</span>
                  <span className="text-2xl font-bold tabular-nums">
                    PKR {(amountToRefund > 0.009 ? amountToRefund : amountToCollect).toFixed(2)}
                  </span>
                </div>
              ) : (
                <div className="mt-2 border-t pt-2 text-sm text-slate-500 dark:border-slate-700">No adjustment needed</div>
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

          <div className={`border-b border-slate-200 p-4 dark:border-slate-800 ${isEditingBill ? 'hidden' : ''}`}>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Step 3 — Payment</label>
            <div className="flex gap-2">
              {(['cash', 'card', 'online', 'wallet'] as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
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
              <label className="text-sm text-slate-600 dark:text-slate-400">Amount tendered (F6)</label>
              <input
                ref={tenderRef}
                type="number"
                value={amountTendered}
                onChange={(e) => setAmountTendered(e.target.value)}
                className="w-full mt-1 px-4 py-3 rounded-lg border border-slate-200 text-xl font-bold"
                placeholder="0.00"
              />
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant="secondary" onClick={setExactCash}>Exact</Button>
                <Button size="sm" variant="ghost" onClick={() => setAmountTendered(String(Math.ceil(total / 500) * 500))}>+500</Button>
                <Button size="sm" variant="ghost" onClick={() => setAmountTendered(String(Math.ceil(total / 1000) * 1000))}>+1000</Button>
              </div>
              {change > 0 && <p className="mt-2 text-lg font-semibold text-green-700">Change: PKR {change.toFixed(2)}</p>}
            </div>
          )}

          {!isEditingBill && (paymentMethod === 'card' || paymentMethod === 'online') && (
            <div className="border-b border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
              {paymentMethod === 'online' ? 'Online payment' : 'Card payment'} — press <strong>F4</strong> to charge PKR {total.toFixed(2)}
            </div>
          )}

          <div className="flex-1" />

          <div className="p-4">
            <Button
              size="lg"
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
                    ? 'Update bill (F4)'
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
