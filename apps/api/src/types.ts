export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export type UserRole = 'super_admin' | 'manager' | 'cashier';

export interface JwtUser {
  id: string;
  name: string;
  role: UserRole;
  permissions?: string[];
}
