import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import type { UserRole } from '@shared/types';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/toastStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  roles?: UserRole[];
}

export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const session = useAuthStore((s) => s.session);
  const denied = useRef(false);

  useEffect(() => {
    if (session && roles && !roles.includes(session.role) && !denied.current) {
      denied.current = true;
      toast.warning('Manager access required — redirected to Checkout');
    }
  }, [session, roles]);

  if (!session) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(session.role)) return <Navigate to="/checkout" replace />;

  return <>{children}</>;
}
