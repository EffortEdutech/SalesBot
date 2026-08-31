import { createServer, type RequestListener, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { BidwrightClient } from '../src/client.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

async function listen(handler: RequestListener) {
  const s = createServer(handler);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const a = s.address();
  if (!a || typeof a === 'string') throw new Error('bad address');
  return `http://127.0.0.1:${a.port}`;
}

describe('BidwrightClient', () => {
  it('re-authenticates exactly once after 401', async () => {
    let logins = 0;
    const base = await listen((req, res) => {
      if (req.url === '/api/auth/login') {
        logins++;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            token: logins === 1 ? 't1' : 't2',
            user: {},
            organization: { id: 'org-a' },
          }),
        );
        return;
      }
      if (req.url === '/catalogs') {
        if (req.headers.authorization === 'Bearer t1') {
          res.statusCode = 401;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'expired' }));
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end('[]');
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    const c = new BidwrightClient({
      baseUrl: base,
      email: 'a',
      password: 'b',
      expectedOrganizationId: 'org-a',
    });
    await expect(c.listCatalogs()).resolves.toEqual([]);
    expect(logins).toBe(2);
  });

  it('rejects wrong org', async () => {
    const base = await listen((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ token: 't', user: {}, organization: { id: 'org-b' } }));
    });
    await expect(
      new BidwrightClient({
        baseUrl: base,
        email: 'a',
        password: 'b',
        expectedOrganizationId: 'org-a',
      }).authenticate(),
    ).rejects.toMatchObject({ code: 'BIDWRIGHT_ORG_MISMATCH' });
  });
});
