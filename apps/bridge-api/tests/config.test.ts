import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('bridge development defaults', () => {
  it('defaults Bridge to the frozen development port 4170', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://example.invalid/postgres',
      BRIDGE_TOKEN_PEPPER: 'p'.repeat(64),
    } as NodeJS.ProcessEnv);
    expect(config.PORT).toBe(4170);
  });
});
