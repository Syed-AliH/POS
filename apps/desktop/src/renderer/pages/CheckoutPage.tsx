import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@mama-babi/ui';
import { getApi } from '@renderer/lib/api';
import { focusElement, getActiveRoute, registerPageShortcuts } from '@renderer/lib/shortcuts';
import { Modal, ModalActions } from '@renderer/components/Modal';
import { ProductHistoryModal } from '@renderer/components/ProductHistoryModal';
import { ProductSearchModal } from '@renderer/components/ProductSearchModal';
import { ReceiptSearchModal } from '@renderer/components/ReceiptSearchModal';
import { WorkflowStepper } from '@renderer/components/WorkflowStepper';
import { toast } from '@renderer/stores/toastStore';
import { useAuthStore } from '@renderer/stores/authStore';
import { formatDateTime } from '@shared/datetime';
import type { Customer, Product, SaleSummary } from '@shared/types';
import { useCartStore } from '../stores/cartStore';

const api = getApi();

type PaymentMethod = 'cash' | 'card' | 'wallet';

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

const WORKFLOW_STEPS = [
  { id: 'search', label: 'Find product', hint: 'F1 search or scan barcode' },
  { id: 'cart', label: 'Review cart', hint: 'Adjust qty and discounts' },
  { id: 'pay', label: 'Take payment', hint: 'F4 to charge' },
  { id: 'done', label: 'Complete', hint: 'Receipt & return if needed' },
];

export function CheckoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const isManager = session?.role === 'manager' || session?.role === 'super_admin';

  const {
    items, discountAmount, discountReason, promotionIds, customer, loyaltyPointsRedeemed, heldSaleId,
    addProduct, updateQuantity, updateLineDiscount, removeItem, clear,
    setDiscount, setCustomer, setLoyaltyRedemption, restoreHeldSale,
    getSubtotal, getTax, getTotal,
  } = useCartStore();

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [productCount, setProductCount] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountTendered, setAmountTendered] = useState('');
  const [taxInclusive, setTaxInclusive] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [barcodeBuffer, setBarcodeBuffer] = useState('');
  const [heldSales, setHeldSales] = useState<SaleSummary[]>([]);
  const [showHeld, setShowHeld] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [successSale, setSuccessSale] = useState<SaleSummary | null>(null);
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [showProductSearch, setShowProductSearch] = useState(false);
  const [showReceipts, setShowReceipts] = useState(false);
  const [redemptionRate, setRedemptionRate] = useState(1);
  const [appliedPromos, setAppliedPromos] = useState<string[]>([]);
  const [giftCardCode, setGiftCardCode] = useState('');
  const [giftCardBalance, setGiftCardBalance] = useState<number | null>(null);
  const [giftCardLoading, setGiftCardLoading] = useState(false);
  const [secondaryCurrency, setSecondaryCurrency] = useState('');
  const [exchangeRate, setExchangeRate] = useState(0);
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  const [stockWarning, setStockWarning] = useState<{ productName: string; stock: number } | null>(null);
  const [historyProduct, setHistoryProduct] = useState<{ id: string; name: string } | null>(null);

  const barcodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const tenderRef = useRef<HTMLInputElement>(null);
  const handleChargeRef = useRef<() => void>(() => undefined);

  const loyaltyDiscount = loyaltyPointsRedeemed * redemptionRate;
  const total = getTotal(taxInclusive) - loyaltyDiscount;
  const change = paymentMethod === 'cash' ? Math.max(0, parseFloat(amountTendered || '0') - total) : 0;
  const secondaryTotal = exchangeRate > 0 && secondaryCurrency ? total * exchangeRate : null;

  const workflowStep = successSale ? 3 : items.length === 0 ? 0 : paymentMethod === 'cash' && !amountTendered && items.length > 0 ? 1 : 2;

  const refreshStockMap = useCallback(async (): Promise<Record<string, number>> => {
    const r = await api.products.list();
    if (r.success) {
      const list = r.data ?? [];
      setProductCount(list.length);
      const map: Record<string, number> = {};
      list.forEach((p) => { map[p.id] = p.stockQty; });
      setStockMap(map);
      return map;
    }
    return {};
  }, []);

  const getOnHandStock = useCallback((productId: string, fallback = 0) => (
    stockMap[productId] ?? fallback
  ), [stockMap]);

  const getAvailableStock = useCallback((productId: string, fallbackOnHand = 0) => {
    const onHand = getOnHandStock(productId, fallbackOnHand);
    const inCart = items.find((i) => i.productId === productId)?.quantity ?? 0;
    return onHand - inCart;
  }, [getOnHandStock, items]);

  useEffect(() => {
    api.settings.get('tax_inclusive').then((r) => {
      if (r.success && r.data) setTaxInclusive(r.data === 'true');
    });
    api.customers.loyaltyRules().then((r) => {
      if (r.success && r.data?.[0]) setRedemptionRate(r.data[0].redemptionRate);
    });
    api.settings.getAll().then((r) => {
      if (r.success && r.data) {
        setSecondaryCurrency(r.data.secondary_currency ?? '');
        setExchangeRate(parseFloat(r.data.exchange_rate ?? '0') || 0);
      }
    });
    refreshStockMap();
  }, [refreshStockMap]);

  useEffect(() => {
    if (location.pathname === '/checkout') refreshStockMap();
  }, [location.pathname, refreshStockMap]);

  useEffect(() => {
    if (!items.length) {
      setDiscount(0);
      setAppliedPromos([]);
      return;
    }
    const subtotal = getSubtotal();
    api.promotions.preview({
      subtotal,
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
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
  }, [items, getSubtotal, setDiscount]);

  const addProductSafe = useCallback(async (product: Product) => {
    const fresh = await api.products.get(product.id);
    const onHand = fresh.success && fresh.data ? fresh.data.stockQty : (stockMap[product.id] ?? product.stockQty);
    setStockMap((prev) => ({ ...prev, [product.id]: onHand }));

    const inCart = items.find((i) => i.productId === product.id)?.quantity ?? 0;
    const available = onHand - inCart;
    const sellingIntoNegative = available <= 0;

    addProduct(product);

    if (sellingIntoNegative) {
      setStockWarning({ productName: product.name, stock: onHand });
    } else {
      toast.success(`Added: ${product.name} — Available: ${available - 1}`);
    }
    setSearch('');
    setSearchResults([]);
    setSearchIndex(0);
    return true;
  }, [items, stockMap, addProduct]);

  const lookupBarcode = useCallback(async (barcode: string) => {
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
    setProcessing(true);
    if (heldSaleId) await api.sales.discardHeld(heldSaleId);
    const heldKey = `H${Date.now().toString(36).toUpperCase()}`;
    const result = await api.sales.create({
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, discountPercent: i.discountPercent })),
      ...saleCustomerPayload(customer, customerName, customerPhone),
      paymentMethod: 'cash',
      status: 'held',
      heldKey,
      discountAmount: discountAmount || undefined,
      promotionIds: promotionIds.length ? promotionIds : undefined,
    });
    if (result.success) {
      toast.info(`Sale held: ${heldKey} — resume with F3`);
      clear();
    } else toast.error(result.error ?? 'Hold failed');
    setProcessing(false);
  }, [items, customer, customerName, customerPhone, discountAmount, promotionIds, heldSaleId, clear, processing]);

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

  const handleCharge = async () => {
    if (!items.length || processing) return;
    setProcessing(true);

    await refreshStockMap();

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

    const result = await api.sales.create({
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, discountPercent: i.discountPercent })),
      ...saleCustomerPayload(customer, customerName, customerPhone),
      paymentMethod,
      amountTendered: paymentMethod === 'cash' ? tendered : undefined,
      discountAmount: discountAmount || undefined,
      discountReason: discountReason || undefined,
      loyaltyPointsRedeemed: loyaltyPointsRedeemed || undefined,
      promotionIds: promotionIds.length ? promotionIds : undefined,
      giftCardCode: paymentMethod === 'wallet' ? giftCardCode : undefined,
      heldSaleId: heldSaleId ?? undefined,
    });

    if (result.success && result.data) {
      const sale = result.data;
      const autoPrint = await api.settings.get('auto_print_receipt');
      if (autoPrint.success && autoPrint.data !== 'false') {
        await api.print.receipt(sale.id);
      }
      setSuccessSale(sale);
      clear();
      setCustomerPhone('');
      setCustomerName('');
      setCustomerResults([]);
      setAmountTendered('');
      setGiftCardCode('');
      setGiftCardBalance(null);
      api.products.list().then((r) => {
        if (r.success) {
          const map: Record<string, number> = {};
          (r.data ?? []).forEach((p) => { map[p.id] = p.stockQty; });
          setStockMap(map);
        }
      });
    } else {
      toast.error(result.error ?? 'Sale failed');
    }
    setProcessing(false);
  };

  useEffect(() => { handleChargeRef.current = handleCharge; });

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    return registerPageShortcuts('/checkout', {
      F1: () => setShowProductSearch(true),
      F2: () => handleHold(),
      F3: () => loadHeldSales(),
      F4: () => handleChargeRef.current(),
      F5: () => focusElement(customerRef, true),
      F6: () => { if (paymentMethod === 'cash') focusElement(tenderRef, true); },
      Escape: () => {
        if (successSale) setSuccessSale(null);
        else if (showHeld) setShowHeld(false);
        else if (items.length) setShowClearConfirm(true);
      },
    });
  }, [handleHold, loadHeldSales, showHeld, paymentMethod, items.length, successSale]);

  useEffect(() => {
    const handleBarcode = (e: KeyboardEvent) => {
      if (getActiveRoute() !== '/checkout') return;
      if ([searchRef, customerRef, tenderRef].some((r) => r.current === document.activeElement)) return;
      if (showHeld || successSale) return;
      if (/^F\d{1,2}$/i.test(e.key) || e.key === 'Escape' || e.altKey) return;
      if (e.key === 'Enter' && barcodeBuffer.length >= 4) {
        lookupBarcode(barcodeBuffer);
        setBarcodeBuffer('');
        return;
      }
      if (e.key.length === 1 && /[0-9a-zA-Z]/.test(e.key)) {
        setBarcodeBuffer((prev) => prev + e.key);
        if (barcodeTimer.current) clearTimeout(barcodeTimer.current);
        barcodeTimer.current = setTimeout(() => setBarcodeBuffer(''), 100);
      }
    };
    window.addEventListener('keydown', handleBarcode);
    return () => window.removeEventListener('keydown', handleBarcode);
  }, [barcodeBuffer, lookupBarcode, showHeld, successSale]);

  const handleSearch = async (q: string) => {
    setSearch(q);
    setSearchIndex(0);
    if (q.length < 2) { setSearchResults([]); return; }
    const result = await api.products.search(q);
    if (result.success) setSearchResults(result.data ?? []);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!searchResults.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchIndex((i) => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      addProductSafe(searchResults[searchIndex]);
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

  const handleCustomerPhoneSearch = async (phone: string) => {
    setCustomerPhone(phone);
    if (phone.length < 3) { setCustomerResults([]); return; }
    const result = await api.customers.search(phone);
    if (result.success) setCustomerResults(result.data ?? []);
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

  const handleLoadDemo = async () => {
    const result = await api.products.seedDemo();
    if (result.success) {
      toast.success(`Loaded ${result.data?.added ?? 0} demo products`);
      const list = await api.products.list();
      if (list.success) {
        setProductCount(list.data?.length ?? 0);
        const map: Record<string, number> = {};
        (list.data ?? []).forEach((p) => { map[p.id] = p.stockQty; });
        setStockMap(map);
      }
      focusElement(searchRef, true);
    } else toast.error(result.error ?? 'Failed');
  };

  const setExactCash = () => setAmountTendered(total.toFixed(2));

  return (
    <div className="h-full flex flex-col">
      <WorkflowStepper steps={WORKFLOW_STEPS} currentStep={workflowStep} />

      {productCount === 0 && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/50">
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200">No products in catalog</p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {isManager ? 'Load demo data or add products in Products tab' : 'Ask a manager to add products first'}
            </p>
          </div>
          {isManager && (
            <div className="flex gap-2 shrink-0">
              <Button size="sm" onClick={handleLoadDemo}>Load Demo Products</Button>
              <Button size="sm" variant="secondary" onClick={() => navigate('/products')}>Add Products</Button>
            </div>
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
              <Button variant="secondary" size="sm" onClick={handleHold} disabled={!items.length || processing}>Hold (F2)</Button>
              <Button variant="secondary" size="sm" onClick={loadHeldSales}>Resume (F3)</Button>
              <Button variant="ghost" size="sm" onClick={() => items.length ? setShowClearConfirm(true) : clear()}>Clear (Esc)</Button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-100 text-2xl dark:bg-primary-950">🛒</div>
                <h3 className="mb-2 text-lg font-semibold text-slate-700 dark:text-slate-200">Start a sale</h3>
                <ol className="max-w-xs space-y-2 text-left text-sm text-slate-500 dark:text-slate-400">
                  <li><strong>1.</strong> Press <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">F1</kbd> and type a product name</li>
                  <li><strong>2.</strong> Or scan a barcode (scanner auto-adds)</li>
                  <li><strong>3.</strong> Press <kbd className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">F4</kbd> to charge when ready</li>
                </ol>
                {productCount === 0 && isManager && (
                  <Button className="mt-4" onClick={handleLoadDemo}>Load Demo Products</Button>
                )}
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90">
                  <tr className="text-left text-sm text-slate-500 dark:text-slate-400">
                    <th className="p-3">Product</th>
                    <th className="p-3 w-28">Qty</th>
                    <th className="p-3 w-16">Disc%</th>
                    <th className="p-3 w-24 text-right">Price</th>
                    <th className="p-3 w-28 text-right">Total</th>
                    <th className="p-3 w-16" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const onHand = getOnHandStock(item.productId);
                    const available = getAvailableStock(item.productId);
                    const lowStock = available > 0 && available <= 5;
                    const negativeStock = onHand < 0 || available < 0;
                    return (
                      <tr
                        key={item.productId}
                        className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                        title="Double-click for product history"
                        onDoubleClick={() => setHistoryProduct({ id: item.productId, name: item.productName })}
                      >
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
            <div className="flex justify-between text-sm text-slate-700 dark:text-slate-300"><span>Subtotal</span><span>PKR {getSubtotal().toFixed(2)}</span></div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-sm text-green-700">
                <span>Promo{appliedPromos.length ? `: ${appliedPromos.join(', ')}` : ''}</span>
                <span>- PKR {discountAmount.toFixed(2)}</span>
              </div>
            )}
            {loyaltyDiscount > 0 && (
              <div className="flex justify-between text-sm text-green-700">
                <span>Loyalty ({loyaltyPointsRedeemed} pts)</span>
                <span>- PKR {loyaltyDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm"><span>Tax</span><span>PKR {getTax(taxInclusive).toFixed(2)}</span></div>
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
                    className="w-20 px-2 py-1 border rounded text-xs"
                    value={loyaltyPointsRedeemed || ''}
                    onChange={(e) => setLoyaltyRedemption(Math.min(parseInt(e.target.value, 10) || 0, customer.loyaltyPoints))}
                  />
                  <button type="button" className="text-slate-400" onClick={() => { setCustomer(null); setLoyaltyRedemption(0); }}>×</button>
                </div>
              </div>
            )}
          </div>

          <div className="border-b border-slate-200 p-4 dark:border-slate-800">
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Step 3 — Payment</label>
            <div className="flex gap-2">
              {(['cash', 'card', 'wallet'] as PaymentMethod[]).map((m) => (
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
                  {m === 'wallet' ? 'Gift Card' : m.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {paymentMethod === 'wallet' && (
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

          {paymentMethod === 'cash' && (
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

          {paymentMethod === 'card' && (
            <div className="border-b border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
              No extra input needed — press <strong>F4</strong> to charge PKR {total.toFixed(2)}
            </div>
          )}

          <div className="flex-1" />

          <div className="p-4">
            <Button
              size="lg"
              className="w-full text-xl py-4"
              onClick={handleCharge}
              disabled={processing || items.length === 0 || (paymentMethod === 'wallet' && (!giftCardCode || (giftCardBalance != null && giftCardBalance < total)))}
            >
              {processing ? 'Processing…' : items.length === 0 ? 'Add products first' : `Charge PKR ${total.toFixed(2)} (F4)`}
            </Button>
          </div>
        </div>
      </div>

      <Modal open={showClearConfirm} title="Clear cart?" onClose={() => setShowClearConfirm(false)}
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
              toast.info('Cart cleared');
            }}
            confirmLabel="Clear cart"
            confirmVariant="danger"
          />
        }
      >
        <p className="text-slate-600">Remove all {items.length} item(s) from the cart?</p>
      </Modal>

      <Modal open={!!successSale} title="Sale complete" onClose={() => setSuccessSale(null)} size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => { if (successSale) navigate(`/returns?sale=${encodeURIComponent(successSale.saleNumber)}`); setSuccessSale(null); }}>Process Return</Button>
            <Button variant="secondary" onClick={async () => { if (successSale) await api.print.receipt(successSale.id); toast.success('Receipt sent'); }}>Print Receipt</Button>
            <Button onClick={() => { setSuccessSale(null); focusElement(searchRef, true); }}>New Sale</Button>
          </>
        }
      >
        {successSale && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="text-4xl mb-2">✓</div>
              <p className="text-2xl font-bold text-green-700">PKR {successSale.totalAmount.toFixed(2)}</p>
              <p className="font-mono text-lg text-slate-700 mt-1">{successSale.saleNumber}</p>
              <p className="text-sm text-slate-500 mt-1">{formatDateTime(successSale.createdAt)}</p>
              <p className="text-xs text-slate-400">Save this number for returns</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
              {successSale.items.map((i) => (
                <div key={i.productId} className="flex justify-between">
                  <span>{i.productName} ×{i.quantity}</span>
                  <span>PKR {i.lineTotal.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 text-center">Next: Returns tab → enter sale # above to process a return</p>
          </div>
        )}
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
