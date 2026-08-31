import { describe, expect, it } from 'vitest';
import { isSalesBotDevProcess } from '../../scripts/dev-processes.mjs';

const repo = 'C:/Users/user/Documents/00-NHL Global Solution/P04-SalesBot/frontdesk-q';

describe('dev process ownership', () => {
  it('accepts a SalesBot Bridge command inside the repository', () => {
    expect(
      isSalesBotDevProcess(
        `node ${repo}/node_modules/.bin/tsx --watch ${repo}/apps/bridge-api/src/server.ts`,
        repo,
      ),
    ).toBe(true);
  });

  it('accepts a SalesBot Vite command inside the repository', () => {
    expect(isSalesBotDevProcess(`node ${repo}/node_modules/vite/bin/vite.js`, repo)).toBe(true);
  });

  it('rejects a foreign command even when it is on a runtime port', () => {
    expect(isSalesBotDevProcess('node C:/other-project/server.js', repo)).toBe(false);
  });

  it('rejects marker-like commands outside the repository', () => {
    expect(isSalesBotDevProcess('node C:/tmp/frontdesk-q/apps/salesbot-web/vite.js', repo)).toBe(
      false,
    );
  });
});
