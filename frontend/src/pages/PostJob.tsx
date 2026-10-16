/**
 * PostJob.tsx
 *
 * Client form to create a new escrow job with a milestone breakdown.
 *
 * Flow:
 *   1. Choose the payment asset, then enter the title, freelancer address,
 *      milestone amounts and expiry.
 *   2. `createAndFund` runs escrow.create() then escrow.fund() on-chain.
 *   3. Persist the off-chain job record via POST /api/jobs (authenticating the
 *      wallet first) so the job — and the asset it pays in — appears in the
 *      Dashboard list, then link the on-chain escrow id.
 *
 * The escrow contract is asset-agnostic; `lib/assets.ts` maps the chosen symbol
 * to its SAC contract id and decimals.
 *
 * Milestone sets can be saved as templates and re-applied here, so a client who
 * posts the same shape of job repeatedly does not retype it (issue #75).
 * Templates live in the browser, keyed per wallet (`lib/templates.ts`).
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/Layout";
import { useEscrow, type CreateAndFundResult } from "../hooks/useEscrow";
import { useWallet } from "../hooks/wallet-context";
import { ASSETS, formatAmount, getAsset, toBaseUnits } from "../lib/assets";
import { authenticate, createJob, linkEscrowId } from "../lib/api";
import { CONTRACT_ADDRESSES, explorerTxUrl } from "../lib/stellar";
import {
  deleteTemplate,
  listTemplates,
  saveTemplate,
  type MilestoneTemplate,
} from "../lib/templates";

interface MilestoneRow {
  amount: string;
}

/**
 * Base units for one row's raw input, treating anything that is not a plain
 * decimal (empty or mid-typing like `.`) as zero so the live total never throws.
 */
function amountToBaseUnits(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d*\.?\d+$/.test(trimmed)) return 0n;
  return toBaseUnits(trimmed, decimals);
}

export default function PostJob() {
  const { createAndFund, isPending, error } = useEscrow();
  const { publicKey, connect, connecting, signMessage } = useWallet();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [freelancer, setFreelancer] = useState("");
  // Default to the first asset this build actually has a SAC for; on the
  // current testnet deployment that is XLM (USDC has no contract id yet).
  const [assetSymbol, setAssetSymbol] = useState(
    ASSETS.find((a) => a.contractId)?.symbol ?? ASSETS[0]?.symbol ?? "USDC",
  );
  const [expiryDays, setExpiryDays] = useState("30");
  const [rows, setRows] = useState<MilestoneRow[]>([{ amount: "" }]);
  const [created, setCreated] = useState<CreateAndFundResult | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<MilestoneTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateNote, setTemplateNote] = useState<string | null>(null);

  const asset = getAsset(assetSymbol);

  // Templates belong to the connected wallet, so they change when it does.
  useEffect(() => {
    setTemplates(publicKey ? listTemplates(publicKey) : []);
    setSelectedTemplate("");
    setTemplateNote(null);
  }, [publicKey]);

  const updateRow = (i: number, amount: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { amount } : row)));

  // Sum in base units and format once, so the on-screen total is the exact value
  // the API stores. Adding decimals as JavaScript numbers shows
  // 0.1 + 0.1 + 0.1 = 0.30000000000000004 and would disagree with the record.
  const total = formatAmount(
    rows.reduce((sum, r) => sum + amountToBaseUnits(r.amount, asset.decimals), 0n),
    asset.decimals,
  );

  /** Milestones with a usable amount, in the asset's base units. */
  const pricedRows = () =>
    rows.filter((row) => amountToBaseUnits(row.amount, asset.decimals) > 0n);

  const canSaveTemplate = publicKey !== null && rows.some((r) => Number(r.amount) > 0);

  /**
   * Restore a saved milestone set: the amounts and, when this build has a SAC
   * for it, the asset they were written in. An asset without a configured SAC
   * is left alone rather than selected — a disabled option would block submit.
   */
  function applyTemplate(id: string) {
    const template = templates.find((entry) => entry.id === id);
    if (!template) return;

    const savedAsset = ASSETS.find((entry) => entry.symbol === template.asset);
    if (savedAsset?.contractId) setAssetSymbol(savedAsset.symbol);
    setRows(
      template.milestones.length > 0
        ? template.milestones.map((milestone) => ({ amount: milestone.amount }))
        : [{ amount: "" }],
    );
    setTemplateNote(`Applied “${template.name}”.`);
  }

  function handleSaveTemplate() {
    if (!publicKey || !canSaveTemplate) return;
    const saved = saveTemplate(publicKey, {
      name: templateName,
      asset: asset.symbol,
      milestones: pricedRows().map((row) => ({ amount: row.amount })),
    });
    if (!saved) {
      setTemplateNote("Could not save the template — give it a name first.");
      return;
    }
    setTemplates(listTemplates(publicKey));
    setSelectedTemplate(saved.id);
    setTemplateName("");
    setTemplateNote(`Saved template “${saved.name}”.`);
  }

  function handleDeleteTemplate() {
    if (!publicKey || !selectedTemplate) return;
    deleteTemplate(publicKey, selectedTemplate);
    setTemplates(listTemplates(publicKey));
    setSelectedTemplate("");
    setTemplateNote("Template deleted.");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey) {
      await connect();
      return;
    }
    if (!asset.contractId) return;
    if (rows.some((r) => !(Number(r.amount) > 0))) return;

    setRecordError(null);
    const expirySeconds = Math.floor(Date.now() / 1000) + Number(expiryDays) * 86400;
    const expiry = BigInt(expirySeconds);

    // 1. On-chain: create + fund the escrow.
    const result = await createAndFund(
      freelancer.trim(),
      asset.contractId,
      rows.map((r) => ({ amount: toBaseUnits(r.amount, asset.decimals), deadline: 0n })),
      expiry,
    );
    if (!result) return;
    setCreated(result);

    // 2. Off-chain: store the job record (and its asset) and link the escrow.
    try {
      const token = await authenticate(publicKey, signMessage);
      const expiresAt = new Date(expirySeconds * 1000).toISOString();
      const job = await createJob(
        {
          title: title.trim(),
          description: description.trim(),
          asset: asset.symbol,
          expiresAt,
          milestones: rows.map((r, i) => ({
            description: `Milestone ${i + 1}`,
            // Send the exact decimal string, not a float round-trip: the API
            // sums base units and stores this as the canonical amount.
            amountUsdc: formatAmount(
              amountToBaseUnits(r.amount, asset.decimals),
              asset.decimals,
            ),
            deadline: expiresAt,
          })),
        },
        token,
      );
      await linkEscrowId(job.id, Number(result.id), token);
    } catch (e) {
      setRecordError(
        e instanceof Error ? e.message : "Could not save the job record",
      );
    }
  }

  return (
    <Layout>
      <h1>Post a Job</h1>

      {!CONTRACT_ADDRESSES.escrow && (
        <p role="alert" className="alert alert-error">
          No escrow contract configured. Run <code>scripts/deploy_testnet.sh</code> or
          set <code>VITE_ESCROW_CONTRACT_ID</code> in <code>.env</code>.
        </p>
      )}
      {!asset.contractId && (
        <p role="alert" className="alert alert-error">
          No contract configured for {asset.symbol}. Set{" "}
          <code>VITE_{asset.symbol}_CONTRACT_ID</code> in <code>.env</code>.
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <p>
          <label>
            Title
            <br />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Landing page redesign"
              minLength={3}
              maxLength={120}
              size={60}
              required
            />
          </label>
        </p>

        <p>
          <label>
            Description
            <br />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What needs to be delivered…"
              minLength={10}
              rows={3}
              cols={60}
              required
            />
          </label>
        </p>

        <p>
          <label>
            Payment asset{" "}
            <select value={assetSymbol} onChange={(e) => setAssetSymbol(e.target.value)}>
              {ASSETS.map((a) => (
                <option key={a.symbol} value={a.symbol} disabled={!a.contractId}>
                  {a.symbol}
                  {a.contractId ? "" : " (not configured)"}
                </option>
              ))}
            </select>
          </label>
          <br />
          <span className="muted">
            This job will be escrowed in <strong>{asset.symbol}</strong> via token{" "}
            <code>{asset.contractId || "(not configured)"}</code>.
          </span>
        </p>

        <p>
          <label>
            Freelancer Stellar address
            <br />
            <input
              value={freelancer}
              onChange={(e) => setFreelancer(e.target.value)}
              placeholder="G..."
              size={60}
              required
            />
          </label>
        </p>

        <fieldset>
          <legend>Templates</legend>
          {!publicKey ? (
            <p className="muted">Connect your wallet to save and reuse milestone templates.</p>
          ) : (
            <>
              {templates.length === 0 ? (
                <p className="muted">No saved templates yet.</p>
              ) : (
                <p>
                  <label>
                    Saved template{" "}
                    <select
                      value={selectedTemplate}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                    >
                      <option value="">Choose…</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name} ({template.milestones.length} milestones,{" "}
                          {template.asset})
                        </option>
                      ))}
                    </select>
                  </label>{" "}
                  <button
                    type="button"
                    onClick={() => applyTemplate(selectedTemplate)}
                    disabled={!selectedTemplate}
                  >
                    Apply template
                  </button>{" "}
                  <button
                    type="button"
                    onClick={handleDeleteTemplate}
                    disabled={!selectedTemplate}
                  >
                    Delete
                  </button>
                </p>
              )}

              <p>
                <label>
                  Save these milestones as{" "}
                  <input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="Weekly retainer"
                    maxLength={60}
                  />
                </label>{" "}
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={templateName.trim().length === 0 || !canSaveTemplate}
                >
                  Save template
                </button>
              </p>
              {templateNote && (
                <p className="muted" role="status">
                  {templateNote}
                </p>
              )}
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>Milestones ({asset.symbol})</legend>
          {rows.map((row, i) => (
            <p key={i}>
              <label>
                Amount #{i + 1}{" "}
                <input
                  type="number"
                  min="0"
                  step={`0.${"0".repeat(asset.decimals - 1)}1`}
                  value={row.amount}
                  onChange={(e) => updateRow(i, e.target.value)}
                  required
                />
              </label>{" "}
              {rows.length > 1 && (
                <button type="button" onClick={() => setRows((r) => r.filter((_, x) => x !== i))}>
                  Remove
                </button>
              )}
            </p>
          ))}
          <button type="button" onClick={() => setRows((r) => [...r, { amount: "" }])}>
            Add milestone
          </button>
          <p>
            Total: <strong>{total}</strong> {asset.symbol}
          </p>
        </fieldset>

        <p>
          <label>
            Expiry (days from now){" "}
            <input
              type="number"
              min="1"
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
            />
          </label>
        </p>

        <button
          type="submit"
          className="btn-primary"
          disabled={isPending("create") || connecting || !asset.contractId}
        >
          {isPending("create")
            ? "Submitting…"
            : publicKey
              ? "Create & Fund Escrow"
              : "Connect & Continue"}
        </button>
      </form>

      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}

      {created && (
        <p className="alert">
          Escrow #{created.id.toString()} created and funded. Transaction{" "}
          <a
            href={explorerTxUrl(created.hash)}
            target="_blank"
            rel="noreferrer"
            title={created.hash}
          >
            <code>{created.hash.slice(0, 12)}…</code>
          </a>{" "}
          <Link to={`/jobs/${created.id}`}>Open job →</Link>
        </p>
      )}

      {recordError && (
        <p role="alert" className="alert alert-error">
          On-chain escrow created, but the job record was not saved: {recordError}
        </p>
      )}
    </Layout>
  );
}
