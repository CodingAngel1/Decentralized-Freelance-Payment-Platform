import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SECURITY.md lives at the repo root; CI runs `npm test` from backend/, so one
// directory up is the repo root. A wrong cwd fails loudly with ENOENT.
const fromRepoRoot = (p: string) =>
  readFileSync(resolve(process.cwd(), "..", p), "utf8");

const securityMd = fromRepoRoot("SECURITY.md");

const SECTION_HEADING = "## Known limitations";
const sectionStart = securityMd.indexOf(SECTION_HEADING);
// Everything after the heading, including any later section, so "the reporting
// path is unchanged" assertions can look at the whole file too.
const knownLimitations =
  sectionStart === -1 ? "" : securityMd.slice(sectionStart);

// These tests keep SECURITY.md honest against the code on main (issue #88).
// The old "Known limitations" section claimed there was no arbitrator panel,
// no dispute timeout, and that the indexer was a stub — all three were
// implemented afterwards, and the doc silently kept telling reporters the
// controls did not exist. Each assertion below pins a fact that was wrong then
// or that a future edit could regress: the stale phrasing must stay gone, the
// contracts-vs-deployed distinction must stay present, and the claims must
// still match the files they cite.
describe("SECURITY.md known limitations", () => {
  it("still has the section the assertions below depend on", () => {
    expect(securityMd).toContain(SECTION_HEADING);
    expect(sectionStart).toBeGreaterThan(-1);
  });

  it("no longer claims the three controls that were implemented (issue #88)", () => {
    expect(knownLimitations).not.toMatch(/no multi-arbitrator panel/i);
    expect(knownLimitations).not.toMatch(/has no timeout escape/i);
    expect(knownLimitations).not.toMatch(/indexer is a stub/i);
  });

  it("distinguishes what the contracts implement from what testnet deploys", () => {
    // The contracts support an M-of-N panel…
    expect(knownLimitations).toMatch(/M-of-N panel/i);
    // …but the deployed testnet configuration is a single arbitrator.
    expect(knownLimitations).toMatch(/deployed testnet configuration is a/i);
    expect(knownLimitations).toMatch(/single arbitrator/i);
  });

  it("describes the dispute timelock as a client-only escape hatch", () => {
    expect(knownLimitations).toMatch(/reclaim_after_dispute_timeout/);
    expect(knownLimitations).toMatch(/only the client may reclaim/i);
  });

  it("describes the indexer's real trust model, not a stub", () => {
    expect(knownLimitations).toMatch(/IndexerCursor/);
    expect(knownLimitations).toMatch(/IndexerDeadLetter/);
    // The rolling RPC window is the gap that makes the mirror best-effort.
    expect(knownLimitations).toMatch(/rolling window/i);
  });

  it("keeps the USDC limitation that is still accurate", () => {
    expect(knownLimitations).toMatch(/USDC is not yet configured on testnet/i);
    expect(fromRepoRoot("deployments/testnet.json")).toMatch(
      /"usdc_contract_id": ""/,
    );
  });

  it("tells readers how to re-verify the claims", () => {
    expect(knownLimitations).toMatch(/grep -rn "DataKey::Arbitrators/);
    expect(knownLimitations).toMatch(/grep -n "IndexerCursor/);
  });

  it("keeps the unaudited/testnet-only scope and the private reporting path", () => {
    expect(securityMd).toMatch(/testnet-only/);
    expect(securityMd).toMatch(/have not been audited/i);
    expect(securityMd).toMatch(/Do not open a public issue/i);
    expect(securityMd).toMatch(/security\/advisories\/new/);
  });

  it("pins each claim to code that actually exists", () => {
    // Fails when the doc's cited evidence changes underneath it — e.g. the
    // testnet panel gaining more members, or USDC being configured — which is
    // exactly when this section should be revisited.
    expect(fromRepoRoot("contracts/dispute/src/lib.rs")).toMatch(
      /DataKey::Arbitrators/,
    );
    expect(fromRepoRoot("contracts/dispute/src/lib.rs")).toMatch(
      /DataKey::Threshold/,
    );
    expect(fromRepoRoot("contracts/escrow/src/lib.rs")).toMatch(
      /reclaim_after_dispute_timeout/,
    );
    expect(fromRepoRoot("contracts/escrow/src/lib.rs")).toMatch(
      /dispute_deadline/,
    );
    expect(fromRepoRoot("backend/src/indexer.ts")).toMatch(/IndexerCursor/);
    expect(fromRepoRoot("backend/src/indexer.ts")).toMatch(/IndexerDeadLetter/);
    expect(fromRepoRoot("scripts/deploy_testnet.sh")).toMatch(/--threshold 1/);
  });
});
