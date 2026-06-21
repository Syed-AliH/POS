import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import type { JwtUser } from '../types';
import { logAuditEvent } from '../services/audit.service';
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  resetPassword,
} from '../services/users.service';

const requirePermission = (permission: string) => async (request: { user: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
  const user = request.user as JwtUser;
  if (user.role === 'super_admin') return; // super_admin bypasses all permission checks
  const perms: string[] = user.permissions ?? [];
  if (!perms.includes(permission)) {
    return reply.code(403).send({ success: false, error: 'Permission denied' });
  }
};

export async function userRoutes(app: FastifyInstance) {
  // List all users
  app.get('/users', { preHandler: [authenticate, requirePermission('users.view')] }, async (request) => {
    const requester = request.user as JwtUser;
    // Only super_admin can list users (managers cannot see user list by design)
    if (requester.role !== 'super_admin') {
      return { success: false, error: 'Administrator access required' };
    }
    return listUsers(app.db);
  });

  // Get single user
  app.get<{ Params: { id: string } }>('/users/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const requester = request.user as JwtUser;
    const targetId = request.params.id;

    // Allow users to view their own profile, or admins to view any
    if (requester.role !== 'super_admin' && requester.id !== targetId) {
      return reply.code(403).send({ success: false, error: 'Permission denied' });
    }
    return getUser(app.db, targetId);
  });

  // Create user
  app.post('/users', { preHandler: [authenticate] }, async (request, reply) => {
    const requester = request.user as JwtUser;
    if (requester.role !== 'super_admin') {
      return reply.code(403).send({ success: false, error: 'Administrator access required' });
    }

    const body = z.object({
      name: z.string().min(1).max(100).trim(),
      username: z.string().min(2).max(50).trim().toLowerCase(),
      password: z.string().min(8).max(128),
      role: z.enum(['super_admin', 'manager', 'cashier']).default('cashier'),
      email: z.string().email().optional().or(z.literal('')),
      phone: z.string().max(30).optional(),
      permissions: z.array(z.string()).optional(),
    }).parse(request.body);

    const result = await createUser(app.db, body, requester.id);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: requester.id,
        module: 'users',
        action: 'user_created',
        recordId: result.data.id,
        newValue: JSON.stringify({ name: body.name, role: body.role, username: body.username }),
        ip: request.ip,
      });
    }
    return result;
  });

  // Update user
  app.patch<{ Params: { id: string } }>('/users/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const requester = request.user as JwtUser;
    const targetId = request.params.id;

    if (requester.role !== 'super_admin') {
      return reply.code(403).send({ success: false, error: 'Administrator access required' });
    }

    const body = z.object({
      name: z.string().min(1).max(100).trim().optional(),
      email: z.string().email().optional().or(z.literal('')),
      phone: z.string().max(30).optional(),
      role: z.enum(['super_admin', 'manager', 'cashier']).optional(),
      isActive: z.boolean().optional(),
      permissions: z.array(z.string()).optional(),
    }).parse(request.body);

    const existing = await getUser(app.db, targetId);
    if (!existing.success) return reply.code(404).send(existing);

    const result = await updateUser(app.db, targetId, body, requester.id);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: requester.id,
        module: 'users',
        action: 'user_updated',
        recordId: targetId,
        oldValue: JSON.stringify({ role: existing.data.role, isActive: existing.data.isActive }),
        newValue: JSON.stringify(body),
        ip: request.ip,
      });
    }
    return result;
  });

  // Soft-delete user
  app.delete<{ Params: { id: string } }>('/users/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const requester = request.user as JwtUser;
    const targetId = request.params.id;

    if (requester.role !== 'super_admin') {
      return reply.code(403).send({ success: false, error: 'Administrator access required' });
    }

    const result = await deleteUser(app.db, targetId, requester.id);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: requester.id,
        module: 'users',
        action: 'user_deleted',
        recordId: targetId,
        ip: request.ip,
      });
    }
    return result;
  });

  // Reset password
  app.post<{ Params: { id: string } }>('/users/:id/reset-password', { preHandler: [authenticate] }, async (request, reply) => {
    const requester = request.user as JwtUser;
    const targetId = request.params.id;

    if (requester.role !== 'super_admin') {
      return reply.code(403).send({ success: false, error: 'Administrator access required' });
    }

    const body = z.object({
      password: z.string().min(8).max(128),
    }).parse(request.body);

    const result = await resetPassword(app.db, targetId, body.password);
    if (result.success) {
      await logAuditEvent(app.db, {
        userId: requester.id,
        module: 'users',
        action: 'password_reset',
        recordId: targetId,
        ip: request.ip,
      });
    }
    return result;
  });
}
