# OmniETF Demo UI Vercel Deploy

This page records the presentation-safe deploy path for the OmniETF demo console.

## Current production URL

- Production alias: https://omni-etf.vercel.app
- Vercel project: `ham3798s-projects/omni-etf`
- Local deploy account used for the first production deploy: `ham3798`

## What gets deployed

The deployed site has two modes:

- Static evidence console: verified tx links, NAV snapshot, CCIP messages, and code path.
- Live Base Sepolia workbench: browser wallet calls for `approve`, `requestDeposit`, `deposit` claim, `requestRedeem`, and `claimRedeem`.
- Live settlement/reserve proof: browser fetches Circle CCTP attestation status and Solana devnet token-account balance from public APIs.

It is not a live backend. CCTP receive submission, Solana reserve execution, and reporter finalization remain separate operator/reporter steps.

- `demo-dist/index.html`
- `demo-dist/styles.css`
- `demo-dist/main.js`
- `demo-dist/wallet.js`
- `demo-dist/state.json`

`state.json` contains verified public demo evidence:

- Base Sepolia vault tx links
- Solana devnet CCTP receive tx link
- CCIP explorer message links
- portfolio/NAV snapshot
- contract code snippets used in the explanation

It must not contain private keys, RPC secrets, `.env` content, or wallet seed material.

## Build locally

```bash
npm run build
npm run verify:demo-ui
```

Expected result:

- `demo-dist/` exists
- desktop and mobile render checks pass
- static fallback uses `/state.json` when `/api/state` is absent
- wallet module, live onchain workbench, CCIP messaging rail, explorer evidence, and contract code path are visible
- Circle CCTP status and Solana reserve balance refresh work from the browser

## Vercel settings

The repo includes `vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "demo-dist",
  "cleanUrls": true,
  "trailingSlash": false
}
```

In the Vercel dashboard:

- Framework preset: Other
- Build command: `npm run build`
- Output directory: `demo-dist`
- Install command: default `npm install`
- Environment variables: none required for the public static demo

## Recommended deploy: GitHub import

Use GitHub import for the presentation site. Vercel should receive the source repo, run the build command, and publish only the generated `demo-dist` directory.

Recommended Vercel project settings:

- Framework preset: Other
- Root directory: repository root
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: `demo-dist`
- Environment variables: none required

Do not deploy the local repository root with a raw CLI source upload if the workspace contains local build artifacts such as `node_modules/`, Foundry output, or Anchor `target/`.
The first CLI root upload attempted to send a large local bundle, so the stable path is source-build from GitHub or prebuilt deploy from `.vercel/output`.

## CLI deploy

The safest CLI path is still source-build deployment through the linked Vercel project:

```bash
npm exec --yes --package=vercel vercel --prod
```

Before using CLI deploy from a local workspace, verify that large local-only directories are ignored:

```bash
git check-ignore node_modules solana/omnietf-custody/target demo-dist .vercel
```

Use `vercel deploy --prebuilt` only after Vercel's own build step has created `.vercel/output`:

```bash
npm exec --yes --package=vercel vercel build
npm exec --yes --package=vercel vercel deploy --prebuilt --prod
```

This path was used successfully for the first production deployment. It uploaded a small prebuilt output instead of the full local workspace.

## GitHub Actions deploy

The repo includes `.github/workflows/deploy-demo-vercel.yml`.

Add these repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Then either:

- push to the `yunsik` branch after changing demo files, or
- run the `Deploy Demo UI to Vercel` workflow manually from GitHub Actions.

The workflow runs:

1. `npm ci`
2. `npm run build`
3. `npm run verify:demo-ui`
4. secret scan against `demo-dist` and `vercel.json`
5. `vercel pull`
6. `vercel build --prod`
7. `vercel deploy --prebuilt --prod`

## Privacy boundary

`.vercelignore` excludes:

- `.env`
- `.env.*`
- `.keys/`
- Foundry build output
- installed libraries
- local logs and transient artifacts

Before deploying, run:

```bash
rg -n "PRIVATE_KEY|SECRET|MNEMONIC|INFURA|ALCHEMY|RPC_URL" demo-dist vercel.json
```

The expected output is no private value. Public labels such as `baseRpcConfigured` may appear only as boolean metadata.

## Presentation script

Use the site in this order:

1. Hero metrics: show NAV, shares, managed assets.
2. Wallet module: connect a Base Sepolia wallet and refresh live vault state.
3. Live workbench: demonstrate direct public reads across the pipeline.
   - Base vault/user state through injected EVM wallet
   - Circle CCTP attestation status through Circle Iris API
   - Solana reserve token-account balance through Solana devnet RPC
4. Live workbench: demonstrate the directly callable Base-side path.
   - `approve USDC`
   - `requestDeposit`
   - `claim deposit` after reporter finalization
   - `requestRedeem`
   - `claimRedeem` after payout is marked claimable
5. Pipeline: click deposit, CCTP settlement, reserve execution, NAV finalization, claim/redeem.
6. CCIP messaging rail: explain control message and CCIP-BnM round trip separately from CCTP USDC.
7. Explorer evidence: open Basescan, Solana explorer, or CCIP explorer links.
8. Protocol code path: show the exact contract functions backing the stage.
9. Claim boundary: state what is proven and what is not claimed.
