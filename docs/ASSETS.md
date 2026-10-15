# Payment assets

The escrow contract is asset-agnostic: `create` takes a token address per escrow
and moves that Stellar Asset Contract (SAC). The symbol → SAC mapping lives in
two small registries, one per app:

- `frontend/src/lib/assets.ts` — symbol, contract id (from `VITE_*`), decimals.
- `backend/src/lib/assets.ts` — symbol, decimals, and the config key holding the
  contract id.

Both registries declare the same two **supported symbols**, **USDC** and **XLM**.
Both assets use 7 decimals; amounts are always converted with the asset's
`decimals` (never a hardcoded `1e7`).

## Supported ≠ configured

A registry entry only means the app *knows* the symbol. A symbol can actually be
paid with only once a SAC contract id is configured for that deployment — and
the current testnet deployment configures **XLM only**:

| Symbol | On the current testnet deployment | Configured via |
|--------|-----------------------------------|----------------|
| XLM | ✅ Configured — SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | `XLM_CONTRACT_ID` / `VITE_XLM_CONTRACT_ID` |
| USDC | ❌ Not configured — `usdc_contract_id` is empty in [`deployments/testnet.json`](../deployments/testnet.json) | `USDC_CONTRACT_ID` / `VITE_USDC_CONTRACT_ID` (both empty) |

This is the same story [TESTNET.md](./TESTNET.md) and the README's project-status
table tell. The app degrades visibly rather than silently: `PostJob` disables
the payment-asset option of any symbol without a contract id, and the testnet
demo (`scripts/demo_testnet.sh`) falls back to the native XLM SAC when no USDC
id is configured.

## Configuring USDC on a deployment

To make USDC payable, obtain its SAC id for the target network. On testnet,
Circle issues USDC from `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
(see [Circle's USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
for the current issuer):

```bash
stellar contract id asset \
  --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --network testnet
```

Then feed the resulting `C...` id to each piece:

1. **Deploy script** — `USDC_CONTRACT_ID=<C...> scripts/deploy_testnet.sh`
   writes it to `deployments/testnet.json` (`usdc_contract_id`) and to
   `frontend/.env` (`VITE_USDC_CONTRACT_ID`). Re-run the script rather than
   hand-editing either file; it backs up the previous `frontend/.env` first.
2. **Frontend** — set `VITE_USDC_CONTRACT_ID`. Vite **inlines** `VITE_*`
   variables at build time, so the hosted frontend needs the variable set on the
   Vercel project (Production *and* Preview) and a redeploy.
3. **Backend** — set `USDC_CONTRACT_ID` in `backend/.env`.
   `backend/src/config.ts` validates it and `backend/src/lib/assets.ts` resolves
   it through the entry's `configKey`. Restart the API to pick it up.

Once configured, USDC becomes selectable in `PostJob`, `POST /api/escrow/build/create`
accepts `asset: "USDC"`, and the demo prefers it over the XLM fallback.

## Adding an asset

1. **Frontend** — append an entry to `ASSETS` in `frontend/src/lib/assets.ts`:

   ```ts
   { symbol: "AQUA", contractId: import.meta.env.VITE_AQUA_CONTRACT_ID ?? "", decimals: 7 }
   ```

   and add `VITE_AQUA_CONTRACT_ID=` to `frontend/.env.example` and `.env`.

2. **Backend** — append an entry to `ASSETS` in `backend/src/lib/assets.ts`:

   ```ts
   AQUA: { symbol: "AQUA", decimals: 7, configKey: "AQUA_CONTRACT_ID" }
   ```

   add the key to the config schema in `backend/src/config.ts` (default `""`) and
   to `backend/.env.example`, then set it in the environment.

3. **Jobs** — `POST /api/jobs` accepts an `asset` symbol (defaults to `USDC`).
   `GET /api/jobs` returns it, and the Dashboard shows the symbol. The
   `/api/escrow/build/create` route pays in the job's asset and rejects any
   symbol not in the registry.

## Notes

- Use only well-known SACs; do not add project- or company-specific assets.
- A job's asset is fixed when the job is created; the on-chain escrow token is
  chosen when the transaction is built.
- The testnet demo (`scripts/demo_testnet.sh`) falls back to the native XLM SAC
  when no USDC contract id is configured.
