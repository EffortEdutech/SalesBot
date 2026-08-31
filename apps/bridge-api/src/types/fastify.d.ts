import type { BridgePrincipal } from '@frontdesk-q/contracts';
declare module 'fastify' {
  interface FastifyRequest {
    bridgePrincipal: BridgePrincipal | null;
  }
}
