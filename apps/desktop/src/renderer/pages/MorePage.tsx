import { Link } from 'react-router-dom';

const links = [
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
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-2xl font-bold mb-2">More</h2>
      <p className="text-slate-500 mb-6">Operations, finance, and back-office tools</p>
      <div className="grid grid-cols-3 gap-4">
        {links.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="bg-white rounded-xl border border-slate-200 p-4 hover:border-pink-300 hover:bg-pink-50 transition-colors"
          >
            <div className="font-semibold text-pink-800">{item.label}</div>
            <div className="text-sm text-slate-500 mt-1">{item.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
