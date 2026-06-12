import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { PageHeader } from '@mama-babi/ui';

const links = [
  { to: '/inventory-report', label: 'Inventory Report', desc: 'Stock levels, value & GRN history' },
  { to: '/supplier-payments', label: 'Supplier Payments', desc: 'Credit balances & payment ledger' },
  { to: '/vendors', label: 'Vendors', desc: 'Supplier management' },
  { to: '/customers', label: 'Customers', desc: 'CRM & loyalty points' },
  { to: '/promotions', label: 'Promotions', desc: 'Discount rules' },
  { to: '/labels', label: 'Labels', desc: 'Batch label printing' },
  { to: '/gift-cards', label: 'Gift Cards', desc: 'Issue & reload store credit' },
  { to: '/expenses', label: 'Expenses', desc: 'Petty cash tracking' },
  { to: '/stocktake', label: 'Stocktake', desc: 'Full inventory count' },
  { to: '/sales', label: 'Sales History', desc: 'Transaction log' },
  { to: '/shifts', label: 'Shifts & EOD', desc: 'Cash reconciliation' },
];

export function MorePage() {
  return (
    <div className="page-shell">
      <PageHeader title="More" description="Operations, finance, and back-office tools" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="group flex items-start justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-card transition-colors hover:border-primary-200 hover:bg-primary-50/40 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-800"
          >
            <div>
              <div className="font-semibold text-slate-900 group-hover:text-primary-700 dark:text-slate-100">{item.label}</div>
              <div className="mt-1 text-sm text-slate-500">{item.desc}</div>
            </div>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 group-hover:text-primary-500" />
          </Link>
        ))}
      </div>
    </div>
  );
}
