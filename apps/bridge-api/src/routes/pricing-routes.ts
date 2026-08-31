import { AppError } from '@frontdesk-q/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { OfferingSearchService } from '@frontdesk-q/offerings';
import type { PriceResolutionService } from '@frontdesk-q/pricing';
import { requirePermission } from '../permissions.js';

const searchSchema = z
  .object({
    query: z.string().trim().min(1).max(300),
    types: z
      .array(z.enum(['product', 'service']))
      .max(2)
      .optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const priceSchema = z
  .object({
    offering_ref: z.string().trim().min(8).max(200),
    quantity: z.number().finite().positive().max(1_000_000),
    requested_uom: z.string().trim().min(1).max(20).optional(),
    context: z.record(z.unknown()).optional(),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      result.error.message,
      422,
      false,
      'Some request fields are invalid.',
    );
  }
  return result.data;
}

export function registerPricingRoutes(
  app: FastifyInstance,
  deps: {
    offerings: OfferingSearchService;
    prices: PriceResolutionService;
  },
): void {
  app.post('/v1/offerings/search', async (request) => {
    requirePermission(request, 'offering.read');
    const body = parse(searchSchema, request.body);
    return deps.offerings.search({
      tenantId: request.bridgePrincipal!.tenantId,
      query: body.query,
      ...(body.types ? { types: body.types } : {}),
      ...(body.limit ? { limit: body.limit } : {}),
    });
  });

  app.post('/v1/prices/resolve', async (request) => {
    requirePermission(request, 'price.read');
    const body = parse(priceSchema, request.body);
    const result = await deps.prices.resolveForRuntime({
      tenantId: request.bridgePrincipal!.tenantId,
      offeringRef: body.offering_ref,
      quantity: body.quantity,
      ...(body.requested_uom ? { requestedUom: body.requested_uom } : {}),
    });
    return { ok: true, ...result };
  });
}
