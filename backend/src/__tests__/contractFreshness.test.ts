import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  checkConfiguredContractIds,
  compareContractIds,
  describeFreshness,
  loadDeploymentRecord,
  resolveDeploymentsFile,
  type ConfiguredContractIds,
  type DeploymentRecord,
} from "../lib/contractFreshness";

/**
 * Synthetic ids — never a real deployment. Each is 56 chars starting with `C`
 * so it has the shape of a Soroban contract id, but the bodies are filler.
 */
const ESCROW_OLD = "COLDESCROW" + "A".repeat(46);
const ESCROW_NEW = "CNEWESCROW" + "B".repeat(46);
const DISPUTE = "CDISPUTE" + "C".repeat(48);
const REPUTATION = "CREPUTATION" + "D".repeat(45);

const DEPLOYED: DeploymentRecord = {
  network: "testnet",
  escrow_contract_id: ESCROW_NEW,
  dispute_contract_id: DISPUTE,
  reputation_contract_id: REPUTATION,
};

const MATCHING: ConfiguredContractIds = {
  escrow: ESCROW_NEW,
  dispute: DISPUTE,
  reputation: REPUTATION,
};

describe("compareContractIds", () => {
  it("is fresh when every deployed id is configured and matches", () => {
    expect(compareContractIds(MATCHING, DEPLOYED)).toEqual({ status: "fresh" });
  });

  it("reports a superseded id as stale with both values", () => {
    const freshness = compareContractIds({ ...MATCHING, escrow: ESCROW_OLD }, DEPLOYED);

    expect(freshness.status).toBe("stale");
    if (freshness.status !== "stale") throw new Error("expected stale");
    expect(freshness.mismatches).toEqual([
      { name: "escrow", configured: ESCROW_OLD, deployed: ESCROW_NEW },
    ]);
    expect(freshness.missing).toEqual([]);
  });

  it("flags a contract that is deployed but not configured as missing", () => {
    const freshness = compareContractIds({ ...MATCHING, dispute: "" }, DEPLOYED);

    expect(freshness).toEqual({ status: "stale", mismatches: [], missing: ["dispute"] });
  });

  it("is unconfigured when no ids are set, whatever the record says", () => {
    expect(
      compareContractIds({ escrow: "", dispute: "", reputation: "" }, DEPLOYED),
    ).toEqual({ status: "unconfigured" });
  });

  it("is unverifiable when configured ids exist but the record is missing", () => {
    const freshness = compareContractIds(MATCHING, null);

    expect(freshness).toEqual({ status: "unverifiable", reason: "no deployment record" });
  });

  it("skips a record field that is empty instead of treating it as a mismatch", () => {
    // USDC is recorded as "" until a SAC is configured; that must not read as
    // "the backend is stale".
    expect(compareContractIds(MATCHING, { ...DEPLOYED, escrow_contract_id: "" })).toEqual({
      status: "fresh",
    });
  });
});

describe("describeFreshness", () => {
  it("stays quiet for anything that is not stale", () => {
    expect(describeFreshness({ status: "fresh" })).toBeNull();
    expect(describeFreshness({ status: "unconfigured" })).toBeNull();
    expect(describeFreshness({ status: "unverifiable", reason: "x" })).toBeNull();
  });

  it("names the stale contracts and prints both ids to reconcile", () => {
    const message = describeFreshness(
      compareContractIds({ ...MATCHING, escrow: ESCROW_OLD, reputation: "" }, DEPLOYED),
    );

    expect(message).toContain("[config] Contract IDs do not match the latest deploy");
    expect(message).toContain(`escrow: configured ${ESCROW_OLD}, deployed ${ESCROW_NEW}`);
    expect(message).toContain("reputation: not configured");
  });
});

describe("resolveDeploymentsFile", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "contracts-"));
  const override = path.join(dir, "custom.json");
  writeFileSync(override, "{}");

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("honours the DEPLOYMENTS_FILE override", () => {
    expect(resolveDeploymentsFile({ DEPLOYMENTS_FILE: override }, dir)).toBe(override);
  });

  it("treats an explicit but missing DEPLOYMENTS_FILE as authoritative", () => {
    // It must not silently fall back to the committed record: the operator asked
    // for a specific file, and comparing against a different one would hide the
    // misconfiguration they are trying to detect.
    expect(
      resolveDeploymentsFile({ DEPLOYMENTS_FILE: path.join(dir, "missing.json") }, dir),
    ).toBeNull();
  });

  it("finds the committed record from the backend package directory", () => {
    const found = resolveDeploymentsFile({}, process.cwd());

    expect(found).not.toBeNull();
    expect(found!.endsWith(path.join("deployments", "testnet.json"))).toBe(true);
  });
});

describe("loadDeploymentRecord", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "contracts-record-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("parses a deploy record", () => {
    const file = path.join(dir, "testnet.json");
    writeFileSync(file, JSON.stringify(DEPLOYED));

    expect(loadDeploymentRecord(file)).toEqual(DEPLOYED);
  });

  it("returns null for invalid JSON, a non-object, or a missing file", () => {
    const invalid = path.join(dir, "invalid.json");
    writeFileSync(invalid, "{ not json");
    const array = path.join(dir, "array.json");
    writeFileSync(array, "[]");

    expect(loadDeploymentRecord(invalid)).toBeNull();
    expect(loadDeploymentRecord(array)).toBeNull();
    expect(loadDeploymentRecord(path.join(dir, "missing.json"))).toBeNull();
  });
});

describe("checkConfiguredContractIds", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "contracts-check-"));
  const file = path.join(dir, "testnet.json");
  writeFileSync(file, JSON.stringify(DEPLOYED));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("warns once when the configured ids are stale", () => {
    const log = vi.fn();

    const freshness = checkConfiguredContractIds(
      { ...MATCHING, escrow: ESCROW_OLD },
      log,
      { DEPLOYMENTS_FILE: file },
      dir,
    );

    expect(freshness.status).toBe("stale");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("superseded contracts");
  });

  it("stays silent when the configured ids match the record", () => {
    const log = vi.fn();

    const freshness = checkConfiguredContractIds(MATCHING, log, { DEPLOYMENTS_FILE: file }, dir);

    expect(freshness).toEqual({ status: "fresh" });
    expect(log).not.toHaveBeenCalled();
  });
});
