import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import type { UserRole } from '@shared/types';
import type { Permission } from '@shared/permissions';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/toastStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  roles?: UserRole[];
  permission?: Permission;
}

export function ProtectedRoute({ children, roles, permission }: ProtectedRouteProps) {
  const session = useAuthStore((s) => s.session);
  const denied = useRef(false);

  const roleOk = !roles || !session || roles.includes(session.role);
  const permOk = !permission || !session || session.role === 'super_admin' || (session.permissions ?? []).includes(permission);
  const allowed = roleOk && permOk;

  useEffect(() => {
    if (session && !allowed && !denied.current) {
      denied.current = true;
      toast.warning('Access denied — redirected to Checkout');
    }
  }, [session, allowed]);

  if (!session) return <Navigate to="/login" replace />;
  if (!allowed) return <Navigate to="/checkout" replace />;

  return <>{children}</>;
}
