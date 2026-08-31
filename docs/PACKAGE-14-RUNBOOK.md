# Package 14 runbook

## 1. Apply the package

Extract `14-salesbot-unified-dev-platform.zip` from the directory that contains `frontdesk-q`.

The ZIP is rooted at `frontdesk-q/` and overwrites only Package-14-owned files.

## 2. Put the current secrets in root `.env`

The operator token currently stored in Supabase was hashed with a specific Bridge pepper.

Before starting the unified platform, make sure the repository-root `.env` contains the **same current pepper** used to produce the 64-character token hash in `bridge_api_tokens`.

Do not paste the pepper, database password, or raw operator token into chat.

Required root variables:

```env
PORT=4170
DATABASE_URL=...
BRIDGE_TOKEN_PEPPER=...
BRIDGE_REQUIRE_TENANT_HEADER=true

VITE_BRIDGE_BASE_URL=/bridge
VITE_DEFAULT_TENANT_ID=tenant_hvac_pilot
BRIDGE_PROXY_TARGET=http://127.0.0.1:4170

BIDWRIGHT_BASE_URL=http://127.0.0.1:4171
```

## 3. Validate

```powershell
pnpm --filter @frontdesk-q/bridge-api typecheck
pnpm --filter @frontdesk-q/bridge-api test
pnpm --filter @frontdesk-q/salesbot-web typecheck
pnpm --filter @frontdesk-q/salesbot-web test
```

## 4. Start everything

```powershell
pnpm dev
```

Expected launcher header:

```text
SalesBot Development
────────────────────────────────────────────
Bridge API      http://127.0.0.1:4170
Operator UI     http://127.0.0.1:4173
Bidwright       http://127.0.0.1:4171
Root env        .env (loaded by each service)
────────────────────────────────────────────
```

The browser should open the SalesBot Operator Console.

## 5. Connect

Use:

- Bridge URL: `/bridge`
- Tenant: `tenant_hvac_pilot`
- the existing local raw `brg_...` operator token

Click **Verify & connect**.

After successful authentication, open **System**. The expected current state before Bidwright/price-book provisioning is approximately:

```text
Bridge API       Connected
SalesBot DB      Connected
Migrations       Ready
Tenant           Active
Operator         Authenticated
Bidwright        Unreachable or Reachable
Price book       Missing
Dograh           Not configured
```

`Bidwright: Unreachable` is expected until the pinned self-hosted Bidwright service is running on port `4171`.

## 6. Stop

Press `Ctrl+C` once in the single terminal running `pnpm dev`. The launcher terminates both child development processes.
