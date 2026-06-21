import type { FastifyReply, FastifyRequest } from 'fastify';
import type { JwtUser, UserRole } from '../types';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ success: false, error: 'Unauthorized' });
  }
}

export function requireRoles(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtUser | undefined;
    if (!user || !roles.includes(user.role)) {
      return reply.code(403).send({ success: false, error: 'Insufficient permissions' });
    }
  };
}
