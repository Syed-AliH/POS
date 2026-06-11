import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { ToastHost } from './components/ToastHost';

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

function PageLoader() {
  return (
    <div className="h-screen flex items-center justify-center text-slate-500">
      Loading...
    </div>
  );
}

export function App() {
  const { init, session, loading, initError } = useAuthStore();

  useEffect(() => {
    init();
  }, [init]);

  if (loading && !session) {
    return <PageLoader />;
  }

  if (initError && !session) {
    return (
      <div className="h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold text-red-600 mb-2">Startup Error</h1>
          <p className="text-slate-600">{initError}</p>
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
            <Route path="reports" element={<ProtectedRoute roles={['manager', 'super_admin']}><ReportsPage /></ProtectedRoute>} />
            <Route path="more" element={<ProtectedRoute roles={['manager', 'super_admin']}><MorePage /></ProtectedRoute>} />
            <Route path="gift-cards" element={<ProtectedRoute roles={['manager', 'super_admin']}><GiftCardsPage /></ProtectedRoute>} />
            <Route path="expenses" element={<ProtectedRoute roles={['manager', 'super_admin']}><ExpensesPage /></ProtectedRoute>} />
            <Route path="stocktake" element={<ProtectedRoute roles={['manager', 'super_admin']}><StocktakePage /></ProtectedRoute>} />
            <Route path="settings" element={<ProtectedRoute roles={['manager', 'super_admin']}><SettingsPage /></ProtectedRoute>} />
            <Route path="sales" element={<ProtectedRoute roles={['cashier', 'manager', 'super_admin']}><SalesHistoryPage /></ProtectedRoute>} />
            <Route path="shifts" element={<ProtectedRoute roles={['manager', 'super_admin']}><ShiftsPage /></ProtectedRoute>} />
          </Route>
          <Route path="*" element={<Navigate to={session ? '/' : '/login'} replace />} />
        </Routes>
    </HashRouter>
  );
}
