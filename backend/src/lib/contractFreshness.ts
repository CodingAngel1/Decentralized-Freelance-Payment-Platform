/**
 * contractFreshness.ts
 *
 * Detects contract ids that the backend is configured with but that no longer
 * match the most recent deploy.
 *
 * The escrow/dispute/reputation ids change on every `scripts/deploy_testnet.sh`
 * run, and they are consumed from more than one place: the frontend build, the
 * backend's environment, and `render.yaml`. A redeploy that updates only the
 * frontend leaves the indexer filtering Soroban RPC for the *superseded*
 * contracts, so it silently applies nothing while `/health` and every other
 * signal stay green (issue #91).
 *
 * `deployments/testnet.json` is the single source of truth for the live ids.
 * These helpers compare the backend's configuration against it and describe the
 * divergence, so `startIndexer()` can log a loud warning instead of mirroring
 * the wrong chain.
 *
 * The comparison is deliberately pure so it can be unit-tested without a chain,
 * a database, or a real deployment record.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** The three contracts the event indexer follows. */
export type ContractIdName = "escrow" | "dispute" | "reputation";

/** The contract ids the backend is running with (from its environment). */
export interface ConfiguredContractIds {
  escrow: string;
  dispute: string;
  reputation: string;
}

/** The subset of `deployments/testnet.json` this check reads. */
export interface DeploymentRecord {
  network?: string;
  escrow_contract_id?: string;
  dispute_contract_id?: string;
  reputation_contract_id?: string;
}

export interface ContractIdMismatch {
  name: ContractIdName;
  /** The superseded id the backend is configured with. */
  configured: string;
  /** The id recorded by the most recent deploy. */
  deployed: string;
}

export type ContractIdFreshness =
  /** Every deployed id is configured and matches. */
  | { status: "fresh" }
  /** No ids are configured at all — the indexer is already disabled and warns. */
  | { status: "unconfigured" }
  /** The deploy record is missing or unreadable, so nothing could be compared. */
  | { status: "unverifiable"; reason: string }
  /** At least one configured id points at a superseded contract. */
  | { status: "stale"; mismatches: ContractIdMismatch[]; missing: ContractIdName[] };

/** The deploy-record field holding each contract's id. */
const RECORD_FIELDS: Record<ContractIdName, keyof DeploymentRecord> = {
  escrow: "escrow_contract_id",
  dispute: "dispute_contract_id",
  reputation: "reputation_contract_id",
};

const CONTRACT_NAMES: ContractIdName[] = ["escrow", "dispute", "reputation"];

/**
 * Compare the configured ids against a parsed deploy record.
 *
 * A record field that is empty means "nothing deployed for this contract yet",
 * so it is skipped rather than treated as a mismatch. A configured id that is
 * empty while the record has one is reported as `missing`: the indexer will not
 * follow that contract at all.
 */
export function compareContractIds(
  configured: ConfiguredContractIds,
  record: DeploymentRecord | null | undefined,
): ContractIdFreshness {
  if (CONTRACT_NAMES.every((name) => configured[name].length === 0)) {
    return { status: "unconfigured" };
  }

  if (!record) {
    return { status: "unverifiable", reason: "no deployment record" };
  }

  const mismatches: ContractIdMismatch[] = [];
  const missing: ContractIdName[] = [];

  for (const name of CONTRACT_NAMES) {
    const configuredId = configured[name];
    const deployedId = String(record[RECORD_FIELDS[name]] ?? "");

    // Nothing deployed for this contract — nothing to compare against.
    if (deployedId.length === 0) continue;

    if (configuredId.length === 0) {
      missing.push(name);
    } else if (configuredId !== deployedId) {
      mismatches.push({ name, configured: configuredId, deployed: deployedId });
    }
  }

  if (mismatches.length === 0 && missing.length === 0) return { status: "fresh" };
  return { status: "stale", mismatches, missing };
}

/**
 * A loud, actionable warning for a stale result, or `null` when there is
 * nothing to say. The `[config]` prefix is intentionally distinctive so it can
 * be grepped out of production logs (see docs/DEPLOYMENT.md).
 */
export function describeFreshness(freshness: ContractIdFreshness): string | null {
  if (freshness.status !== "stale") return null;

  const details = [
    ...freshness.mismatches.map(
      (mismatch) =>
        `  - ${mismatch.name}: configured ${mismatch.configured}, deployed ${mismatch.deployed}`,
    ),
    ...freshness.missing.map(
      (name) =>
        `  - ${name}: not configured — its events will not be indexed at all`,
    ),
  ];

  return (
    "[config] Contract IDs do not match the latest deploy — the indexer is " +
    "probably following superseded contracts and will silently miss events. " +
    "Re-run scripts/deploy_testnet.sh and update ESCROW_CONTRACT_ID, " +
    "DISPUTE_CONTRACT_ID and REPUTATION_CONTRACT_ID, then restart the backend.\n" +
    details.join("\n")
  );
}

/**
 * Where the committed deploy record lives. Tried in order, first hit wins:
 *
 *   1. `DEPLOYMENTS_FILE` (explicit override, relative to `cwd`)
 *   2. `<cwd>/deployments/testnet.json` — run from the repo root
 *   3. `<cwd>/../deployments/testnet.json` — run from `backend/`
 *   4. `../../../deployments/testnet.json` from this module — tsx, repo root
 *   5. `../../deployments/testnet.json` from this module — built, `/app/deployments`
 */
export function resolveDeploymentsFile(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string | null {
  // An explicit DEPLOYMENTS_FILE is authoritative: if it is set but missing we
  // report "no record" instead of silently comparing against some other file.
  const override = env.DEPLOYMENTS_FILE;
  if (override) {
    const resolved = path.resolve(cwd, override);
    return existsSync(resolved) ? resolved : null;
  }

  const candidates = [
    path.resolve(cwd, "deployments/testnet.json"),
    path.resolve(cwd, "../deployments/testnet.json"),
    path.resolve(__dirname, "../../../deployments/testnet.json"),
    path.resolve(__dirname, "../../deployments/testnet.json"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Parse a deploy record, or return `null` when the file is missing/invalid. */
export function loadDeploymentRecord(file: string): DeploymentRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as DeploymentRecord;
  } catch {
    return null;
  }
}

/**
 * Read the deploy record, compare it with the configured ids and log the
 * warning when they diverge. Injected `env`/`cwd`/`log` keep it testable.
 */
export function checkConfiguredContractIds(
  configured: ConfiguredContractIds,
  log: (message: string) => void = console.warn,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ContractIdFreshness {
  const file = resolveDeploymentsFile(env, cwd);
  const record = file ? loadDeploymentRecord(file) : null;
  const freshness = compareContractIds(configured, record);

  const warning = describeFreshness(freshness);
  if (warning) log(warning);

  return freshness;
}
