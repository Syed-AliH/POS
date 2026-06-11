import { formatDateTime } from '@shared/datetime';
import type { ReceiptPreview as ReceiptPreviewData } from '@shared/types';

export function ReceiptPreview({ data, className }: { data: ReceiptPreviewData; className?: string }) {
  return (
    <div className={`font-mono text-sm bg-white border rounded-lg p-4 max-w-md mx-auto ${className ?? ''}`}>
      <div className="text-center border-b pb-2 mb-2">
        <div className="font-bold text-base">{data.storeName}</div>
        {data.storeAddress && <div className="text-xs text-slate-500">{data.storeAddress}</div>}
        {data.storePhone && <div className="text-xs text-slate-500">{data.storePhone}</div>}
      </div>
      <div className="text-xs text-slate-500 mb-2">
        <div>Sale: {data.saleNumber}</div>
        <div>Cashier: {data.cashierName}</div>
        <div>{formatDateTime(data.createdAt)}</div>
      </div>
      <table className="w-full text-xs mb-2">
        <tbody>
          {data.items.map((item, i) => (
            <tr key={i}>
              <td className="py-0.5">{item.name}</td>
              <td className="text-right py-0.5">{item.qty}×{item.unitPrice.toFixed(0)}</td>
              <td className="text-right py-0.5 w-16">{item.lineTotal.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t pt-2 text-xs space-y-0.5">
        <div className="flex justify-between"><span>Subtotal</span><span>{data.subtotal.toFixed(2)}</span></div>
        {data.discountAmount > 0 && <div className="flex justify-between"><span>Discount</span><span>-{data.discountAmount.toFixed(2)}</span></div>}
        {data.taxAmount > 0 && <div className="flex justify-between"><span>Tax</span><span>{data.taxAmount.toFixed(2)}</span></div>}
        <div className="flex justify-between font-bold text-sm"><span>Total</span><span>PKR {data.totalAmount.toFixed(2)}</span></div>
        <div className="flex justify-between capitalize"><span>{data.paymentMethod.replace('_', ' ')}</span></div>
        {data.amountTendered != null && <div className="flex justify-between"><span>Tendered</span><span>{data.amountTendered.toFixed(2)}</span></div>}
        {data.changeGiven != null && data.changeGiven > 0 && <div className="flex justify-between"><span>Change</span><span>{data.changeGiven.toFixed(2)}</span></div>}
      </div>
      <div className="text-center text-xs text-slate-500 mt-3 border-t pt-2">{data.footerMessage}</div>
    </div>
  );
}
