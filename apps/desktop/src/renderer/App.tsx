import { lazy, Suspense, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from '@mama-babi/ui';
import { isBundledMode } from '@shared/deployment';
import { isValidApiUrl } from '@shared/apiUrl';
import { IPC_CHANNELS } from '@shared/ipc-channels';
import { useAuthStore } from './stores/authStore';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { ToastHost } from './components/ToastHost';
import { SetupPage } from './pages/SetupPage';

const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage').then((m) => ({ default: m.CheckoutPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ProductsPage = lazy(() => import('./pages/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const SalesHistoryPage = lazy(() => import('./pages/SalesHistoryPage').then((m) => ({ default: m.SalesHistoryPage })));
const ReturnsPage = lazy(() => import('./pages/ReturnsPage').then((m) => ({ default: m.ReturnsPage })));
const ShiftsPage = lazy(() => import('./pages/ShiftsPage').then((m) => ({ default: m.ShiftsPage })));
const VendorsPage = lazy(() => import('./pages/VendorsPage').then((m) => ({ default: m.VendorsPage })));
const GrnPage = lazy(() => import('./pages/GrnPage').then((m) => ({ default: m.GrnPage })));
const CustomersPage = lazy(() => import('./pages/CustomersPage').then((m) => ({ default: m.CustomersPage })));
const PromotionsPage = lazy(() => import('./pages/PromotionsPage').then((m) => ({ default: m.PromotionsPage })));
const LabelsPage = lazy(() => import('./pages/LabelsPage').then((m) => ({ default: m.LabelsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const MorePage = lazy(() => import('./pages/MorePage').then((m) => ({ default: m.MorePage })));
const GiftCardsPage = lazy(() => import('./pages/GiftCardsPage').then((m) => ({ default: m.GiftCardsPage })));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage })));
const StocktakePage = lazy(() => import('./pages/StocktakePage').then((m) => ({ default: m.StocktakePage })));
const InventoryReportPage = lazy(() => import('./pages/InventoryReportPage').then((m) => ({ default: m.InventoryReportPage })));
const SupplierPaymentsPage = lazy(() => import('./pages/SupplierPaymentsPage').then((m) => ({ default: m.SupplierPaymentsPage })));
const ReceiptDesignerPage = lazy(() => import('./pages/ReceiptDesignerPage').then((m) => ({ default: m.ReceiptDesignerPage })));
const LabelDesignerPage = lazy(() => import('./pages/LabelDesignerPage').then((m) => ({ default: m.LabelDesignerPage })));
const LabelTemplateConfigPage = lazy(() => import('./pages/LabelTemplateConfigPage').then((m) => ({ default: m.LabelTemplateConfigPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));

function PageLoader() {
  return <Spinner className="h-screen" label="Loading…" />;
}

export function App() {
  const { init, session, loading, initError } = useAuthStore();
  const [setupChecked, setSetupChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    window.electron?.ipcRenderer
      .invoke(IPC_CHANNELS.APP_GET_CONFIG)
      .then((cfg: { apiUrl?: string; deploymentMode?: string } | null) => {
        if (isBundledMode(cfg?.deploymentMode)) {
          setNeedsSetup(false);
        } else if (!isValidApiUrl(cfg?.apiUrl)) {
          setNeedsSetup(true);
        }
        setSetupChecked(true);
      })
      .catch(() => setSetupChecked(true));
  }, []);

  useEffect(() => {
    if (setupChecked && !needsSetup) init();
  }, [setupChecked, needsSetup, init]);

  if (!setupChecked) {
    return <PageLoader />;
  }

  if (needsSetup) {
    return (
      <SetupPage
        onSaved={() => {
          setNeedsSetup(false);
          init();
        }}
      />
    );
  }

  if (loading && !session) {
    return <PageLoader />;
  }

  if (initError && !session) {
    return (
      <div className="h-screen flex items-center justify-center p-8 bg-surface-muted dark:bg-slate-950">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold text-red-600 mb-2 dark:text-red-400">Startup Error</h1>
          <p className="text-slate-600 dark:text-slate-300">{initError}</p>
          <p className="text-sm text-slate-400 mt-4">Try restarting with: pnpm dev</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <HashRouter>
        <Suspense fallback={<PageLoader />}>
          <LoginPage />
        </Suspense>
        <ToastHost />
      </HashRouter>
    );
  }

  return (
    <HashRouter>
        <Routes>
          <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to={session?.role === 'cashier' ? '/checkout' : '/dashboard'} replace />} />
            <Route path="checkout" element={<CheckoutPage />} />
            <Route path="returns" element={<ReturnsPage />} />
            <Route path="dashboard" element={<ProtectedRoute roles={['manager', 'super_admin']}><DashboardPage /></ProtectedRoute>} />
            <Route path="products" element={<ProtectedRoute roles={['manager', 'super_admin']}><ProductsPage /></ProtectedRoute>} />
            <Route path="inventory" element={<Navigate to="/grn" replace />} />
            <Route path="grn" element={<ProtectedRoute roles={['manager', 'super_admin']}><GrnPage /></ProtectedRoute>} />
            <Route path="vendors" element={<ProtectedRoute roles={['manager', 'super_admin']}><VendorsPage /></ProtectedRoute>} />
            <Route path="customers" element={<ProtectedRoute roles={['manager', 'super_admin']}><CustomersPage /></ProtectedRoute>} />
            <Route path="promotions" element={<ProtectedRoute roles={['manager', 'super_admin']}><PromotionsPage /></ProtectedRoute>} />
            <Route path="labels" element={<ProtectedRoute roles={['manager', 'super_admin']}><LabelsPage /></ProtectedRoute>} />
            <Route path="label-designer" element={<ProtectedRoute roles={['manager', 'super_admin']}><LabelDesignerPage /></ProtectedRoute>} />
            <Route path="label-template-config" element={<ProtectedRoute roles={['manager', 'super_admin']}><LabelTemplateConfigPage /></ProtectedRoute>} />
            <Route path="receipt-designer" element={<ProtectedRoute roles={['manager', 'super_admin']}><ReceiptDesignerPage /></ProtectedRoute>} />
            <Route path="reports" element={<ProtectedRoute roles={['manager', 'super_admin']}><ReportsPage /></ProtectedRoute>} />
            <Route path="inventory-report" element={<ProtectedRoute roles={['manager', 'super_admin']}><InventoryReportPage /></ProtectedRoute>} />
            <Route path="supplier-payments" element={<ProtectedRoute roles={['manager', 'super_admin']}><SupplierPaymentsPage /></ProtectedRoute>} />
            <Route path="more" element={<ProtectedRoute roles={['manager', 'super_admin']}><MorePage /></ProtectedRoute>} />
            <Route path="gift-cards" element={<ProtectedRoute roles={['manager', 'super_admin']}><GiftCardsPage /></ProtectedRoute>} />
            <Route path="expenses" element={<ProtectedRoute roles={['manager', 'super_admin']}><ExpensesPage /></ProtectedRoute>} />
            <Route path="stocktake" element={<ProtectedRoute roles={['manager', 'super_admin']}><StocktakePage /></ProtectedRoute>} />
            <Route path="settings" element={<ProtectedRoute roles={['manager', 'super_admin']}><SettingsPage /></ProtectedRoute>} />
            <Route path="users" element={<ProtectedRoute roles={['super_admin']}><UsersPage /></ProtectedRoute>} />
            <Route path="sales" element={<ProtectedRoute roles={['manager', 'super_admin']}><SalesHistoryPage /></ProtectedRoute>} />
            <Route path="shifts" element={<ProtectedRoute roles={['manager', 'super_admin']}><ShiftsPage /></ProtectedRoute>} />
          </Route>
          <Route path="*" element={<Navigate to={session ? '/' : '/login'} replace />} />
        </Routes>
    </HashRouter>
  );
}
