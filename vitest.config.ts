import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

function r(path: string) {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      '@frontdesk-q/auth': r('./packages/auth/src/index.ts'),
      '@frontdesk-q/bidwright': r('./packages/bidwright/src/index.ts'),
      '@frontdesk-q/contracts': r('./packages/contracts/src/index.ts'),
      '@frontdesk-q/db': r('./packages/db/src/index.ts'),
      '@frontdesk-q/idempotency': r('./packages/idempotency/src/index.ts'),
      '@frontdesk-q/offerings': r('./packages/offerings/src/index.ts'),
      '@frontdesk-q/pricing': r('./packages/pricing/src/index.ts'),
      '@frontdesk-q/quotes': r('./packages/quotes/src/index.ts'),
      '@frontdesk-q/tenant': r('./packages/tenant/src/index.ts'),
    },
  },
  test: { environment: 'node', globals: false, testTimeout: 20_000, hookTimeout: 20_000 },
});
