import type { ReactNode } from 'react';
import { formatDateTime } from '@shared/datetime';
import {
  resolveStoreNameFontFamily,
  SAMPLE_RECEIPT_SALE,
  type ReceiptSale,
  type ReceiptTemplateConfig,
  type ReceiptTemplateSections,
} from '@mama-babi/printer';
import type { ReceiptTemplate } from '@shared/types';
import { cn } from '@mama-babi/ui';
import { ReceiptCustomFontStyle } from './ReceiptCustomFontStyle';

function charsForWidth(widthMm: 58 | 80) {
  return widthMm === 58 ? 32 : 42;
}

function QrPlaceholder({ size = 64 }: { size?: number }) {
  const cells = 7;
  return (
    <div
      className="mx-auto grid gap-px bg-slate-900 p-1"
      style={{ width: size, height: size, gridTemplateColumns: `repeat(${cells}, 1fr)` }}
    >
      {Array.from({ length: cells * cells }).map((_, i) => (
        <div key={i} className={cn('aspect-square', (i + Math.floor(i / cells)) % 2 === 0 ? 'bg-white' : 'bg-slate-900')} />
      ))}
    </div>
  );
}

export function templateToConfig(tpl: ReceiptTemplate): ReceiptTemplateConfig {
  return { widthMm: tpl.widthMm, sections: tpl.sections, header: tpl.header, footer: tpl.footer };
}

type SectionKey =
  | keyof ReceiptTemplateSections
  | 'headerText'
  | 'thankYou'
  | 'returnPolicy'
  | 'taxInfo'
  | 'qrCode';

export function ThermalReceiptPreview({
  template,
  sale = SAMPLE_RECEIPT_SALE,
  currency = 'PKR',
  activeSection,
  onSectionClick,
  designMode = false,
  className,
}: {
  template: ReceiptTemplate;
  sale?: ReceiptSale;
  currency?: string;
  activeSection?: SectionKey;
  onSectionClick?: (section: SectionKey) => void;
  designMode?: boolean;
  className?: string;
}) {
  const { widthMm, sections, header, footer } = template;
  const charWidth = charsForWidth(widthMm);
  const pxWidth = widthMm === 58 ? 220 : 302;

  const fmt = (n: number) => `${currency} ${n.toFixed(2)}`;
  const divider = '═'.repeat(Math.min(charWidth, 24));
  const dash = '─'.repeat(Math.min(charWidth, 24));

  const storeNameText = header.storeName?.trim();
  const storeNameStyle = {
    fontSize: header.storeNameFontSize ?? 14,
    fontFamily: resolveStoreNameFontFamily(header),
    fontWeight: header.storeNameFontWeight === 'normal' ? 400 : 700,
    textTransform: (header.storeNameUppercase === false ? 'none' : 'uppercase') as 'none' | 'uppercase',
  };

  const block = (key: SectionKey, children: ReactNode, hidden?: boolean) => {
    if (hidden) return null;
    const selected = activeSection === key;
    const interactive = !!onSectionClick;
    return (
      <div
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={interactive ? () => onSectionClick?.(key) : undefined}
        onKeyDown={interactive ? (e) => e.key === 'Enter' && onSectionClick?.(key) : undefined}
        className={cn(
          'w-full rounded transition-colors',
          interactive && 'cursor-pointer hover:bg-primary-50/80',
          selected && 'ring-2 ring-primary-400 ring-inset bg-primary-50/50',
        )}
      >
        {children}
      </div>
    );
  };

  const hint = (text: string, focused: boolean) => {
    if (!designMode || !focused) return null;
    return <span className="text-slate-400 italic">{text}</span>;
  };

  const hasHeaderContent =
    (sections.showLogo && (header.logoDataUrl || (designMode && activeSection === 'showLogo'))) ||
    (sections.showStoreName && (storeNameText || (designMode && activeSection === 'showStoreName'))) ||
    (sections.showAddress && (header.address?.trim() || (designMode && activeSection === 'showAddress'))) ||
    (sections.showPhone && header.phone?.trim()) ||
    (sections.showEmail && header.email?.trim()) ||
    (sections.showHeaderText && (header.headerText?.trim() || (designMode && activeSection === 'headerText')));

  const hasFooterContent =
    (sections.showThankYou && (footer.thankYouMessage?.trim() || footer.message?.trim() || (designMode && activeSection === 'thankYou'))) ||
    (sections.showReturnPolicy && (footer.returnPolicy?.trim() || (designMode && activeSection === 'returnPolicy'))) ||
    (sections.showQrCode && (designMode && activeSection === 'qrCode'));

  const hasMeta = sections.showSaleNumber || sections.showDate || sections.showCashier;
  const hasItems = sections.showItems && sale.items.length > 0;
  const hasTotals = sections.showSubtotal || sections.showDiscount || sections.showTax || true;
  const hasPayment = sections.showPayment;

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <ReceiptCustomFontStyle header={header} />
      <div
        className="relative bg-[#faf8f5] text-slate-900 shadow-lg border border-slate-200 font-mono text-[11px] leading-relaxed select-none overflow-hidden"
        style={{ width: pxWidth, padding: '16px 12px' }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-slate-300/40 to-transparent" />

        {sections.showLogo && block('showLogo', (
          <div className="text-center py-2">
            {header.logoDataUrl ? (
              <img src={header.logoDataUrl} alt="Logo" className="mx-auto max-h-14 max-w-[85%] object-contain" />
            ) : designMode && activeSection === 'showLogo' ? (
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded border border-dashed border-slate-300 bg-white text-[9px] text-slate-400">
                LOGO
              </div>
            ) : null}
          </div>
        ))}

        {sections.showStoreName && block('showStoreName', (
          <div className="text-center py-1 tracking-wide" style={storeNameStyle}>
            {storeNameText || hint('Your shop name', activeSection === 'showStoreName')}
          </div>
        ))}

        {sections.showAddress && header.address?.trim() && block('showAddress', (
          <div className="text-center text-[10px] text-slate-600 whitespace-pre-wrap">{header.address}</div>
        ))}

        {sections.showAddress && !header.address?.trim() && designMode && activeSection === 'showAddress' && block('showAddress', (
          <div className="text-center text-[10px] text-slate-400 italic">Store address</div>
        ))}

        {((sections.showPhone && header.phone?.trim()) || (sections.showEmail && header.email?.trim())) && block('showPhone', (
          <div className="text-center text-[10px] text-slate-600 space-y-0.5 py-1">
            {sections.showPhone && header.phone?.trim() && <div>{header.phone}</div>}
            {sections.showEmail && header.email?.trim() && <div>{header.email}</div>}
          </div>
        ))}

        {sections.showHeaderText && header.headerText?.trim() && block('headerText', (
          <div className="text-center text-[10px] text-slate-600 italic py-1">{header.headerText}</div>
        ))}

        {sections.showHeaderText && !header.headerText?.trim() && designMode && activeSection === 'headerText' && block('headerText', (
          <div className="text-center text-[10px] text-slate-400 italic py-1">Header message</div>
        ))}

        {hasHeaderContent && (
          <div className="text-center text-slate-400 py-1">{divider}</div>
        )}

        {hasMeta && (
          <>
            {sections.showSaleNumber && <div>Receipt: {sale.saleNumber}</div>}
            {sections.showDate && <div>Date: {formatDateTime(sale.createdAt)}</div>}
            {sections.showCashier && <div>Cashier: {sale.cashierName}</div>}
          </>
        )}

        {hasMeta && (hasItems || hasTotals) && (
          <div className="text-slate-300 py-1">{dash}</div>
        )}

        {hasItems && block('showItems', (
          <div className="space-y-2 py-1">
            {sale.items.map((item, i) => (
              <div key={i}>
                <div className="break-words">{item.productName}</div>
                <div className="flex justify-between text-[10px] gap-2">
                  <span className="shrink-0">{item.quantity} × {fmt(item.unitPrice)}</span>
                  <span className="shrink-0">{fmt(item.lineTotal)}</span>
                </div>
              </div>
            ))}
          </div>
        ))}

        {hasItems && hasTotals && (
          <div className="text-slate-300 py-1">{dash}</div>
        )}

        {hasTotals && (
          <>
            {sections.showSubtotal && (
              <div className="flex justify-between gap-2"><span>Subtotal:</span><span className="shrink-0">{fmt(sale.subtotal)}</span></div>
            )}
            {sections.showDiscount && sale.discountAmount > 0 && (
              <div className="flex justify-between gap-2"><span>Discount:</span><span className="shrink-0">-{fmt(sale.discountAmount)}</span></div>
            )}
            {sections.showTax && (
              <div className="flex justify-between gap-2"><span>Tax:</span><span className="shrink-0">{fmt(sale.taxAmount)}</span></div>
            )}
            <div className="flex justify-between font-bold text-xs py-0.5 gap-2">
              <span>TOTAL:</span><span className="shrink-0">{fmt(sale.totalAmount)}</span>
            </div>
          </>
        )}

        {hasTotals && hasPayment && (
          <div className="text-slate-300 py-1">{dash}</div>
        )}

        {hasPayment && block('showPayment', (
          <div className="space-y-0.5">
            <div>Payment: {sale.paymentMethod.toUpperCase()}</div>
            {sale.amountTendered != null && (
              <>
                <div className="flex justify-between gap-2"><span>Tendered:</span><span className="shrink-0">{fmt(sale.amountTendered)}</span></div>
                <div className="flex justify-between gap-2"><span>Change:</span><span className="shrink-0">{fmt(sale.changeGiven ?? 0)}</span></div>
              </>
            )}
          </div>
        ))}

        {sections.showTaxInfo && footer.taxInfo?.trim() && block('taxInfo', (
          <div className="text-[10px] text-slate-600 py-2 whitespace-pre-wrap">{footer.taxInfo}</div>
        ))}

        {sections.showTaxInfo && !footer.taxInfo?.trim() && designMode && activeSection === 'taxInfo' && block('taxInfo', (
          <div className="text-[10px] text-slate-400 italic py-2">Tax registration info</div>
        ))}

        {(hasFooterContent || (sections.showTaxInfo && footer.taxInfo?.trim())) && (
          <div className="text-center text-slate-400 py-1">{divider}</div>
        )}

        {sections.showThankYou && (footer.thankYouMessage?.trim() || footer.message?.trim()) && block('thankYou', (
          <div className="text-center text-[10px] py-2">{footer.thankYouMessage || footer.message}</div>
        ))}

        {sections.showThankYou && !(footer.thankYouMessage?.trim() || footer.message?.trim()) && designMode && activeSection === 'thankYou' && block('thankYou', (
          <div className="text-center text-[10px] text-slate-400 italic py-2">Thank you message</div>
        ))}

        {sections.showReturnPolicy && footer.returnPolicy?.trim() && block('returnPolicy', (
          <div className="text-center text-[9px] text-slate-500 py-1 whitespace-pre-wrap">{footer.returnPolicy}</div>
        ))}

        {sections.showReturnPolicy && !footer.returnPolicy?.trim() && designMode && activeSection === 'returnPolicy' && block('returnPolicy', (
          <div className="text-center text-[9px] text-slate-400 italic py-1">Return policy</div>
        ))}

        {sections.showQrCode && block('qrCode', (
          <div className="py-3 text-center">
            <QrPlaceholder size={widthMm === 58 ? 56 : 72} />
            {(footer.qrCodeContent?.trim() || sale.saleNumber) && (
              <div className="text-[9px] text-slate-500 mt-1 break-all">{footer.qrCodeContent?.trim() || sale.saleNumber}</div>
            )}
          </div>
        ))}

        {(hasFooterContent || sections.showQrCode) && (
          <div className="text-center text-slate-400 pt-2">{divider}</div>
        )}
        <div className="h-2" />
      </div>
      <p className="mt-3 text-xs text-slate-400 shrink-0">{widthMm}mm thermal paper · {charWidth} chars/line</p>
    </div>
  );
}
