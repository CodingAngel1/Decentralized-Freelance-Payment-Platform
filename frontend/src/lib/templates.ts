/**
 * templates.ts
 *
 * Saved milestone sets ("templates"), so a client does not re-enter the same
 * breakdown on every job (issue #75).
 *
 * Stored in `localStorage`, keyed per client address: a milestone set is a
 * personal shortcut, it carries no funds, and keeping it on the device avoids
 * an API round-trip and any question about who may read it. Every read is
 * defensive — corrupt, foreign or hand-edited storage degrades to "no
 * templates" rather than throwing in the middle of the post-a-job form.
 *
 * Contributor Notes:
 * - Only the amount is stored per milestone, because that is all the form asks
 *   for; descriptions are generated (`Milestone N`) when the job is created.
 * - The asset travels with the template so applying one restores the decimals
 *   the amounts were written in.
 */

export interface TemplateMilestone {
  /** Amount as the user typed it (whole units of `asset`). */
  amount: string;
}

export interface MilestoneTemplate {
  id: string;
  name: string;
  /** Asset symbol the set is denominated in (see `lib/assets.ts`). */
  asset: string;
  milestones: TemplateMilestone[];
  createdAt: string;
}

/** Versioned so a future shape change can be migrated instead of misread. */
const STORAGE_PREFIX = "stellar-freelance:templates:v1:";
const MAX_NAME = 60;
/** Enough for anyone's real workload; keeps the picker readable. */
const MAX_TEMPLATES = 20;

const storageKey = (address: string) => `${STORAGE_PREFIX}${address}`;

/** `localStorage`, or `null` when it is unavailable (SSR, privacy mode). */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Shape check for anything coming out of storage, which may have been edited. */
function isTemplate(value: unknown): value is MilestoneTemplate {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MilestoneTemplate>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.asset === "string" &&
    typeof candidate.createdAt === "string" &&
    Array.isArray(candidate.milestones) &&
    candidate.milestones.every(
      (milestone) =>
        typeof milestone === "object" &&
        milestone !== null &&
        typeof (milestone as TemplateMilestone).amount === "string",
    )
  );
}

function write(address: string, templates: MilestoneTemplate[]): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(storageKey(address), JSON.stringify(templates));
    return true;
  } catch {
    // Quota or a disabled store: the caller reports it, nothing is thrown.
    return false;
  }
}

/** A client's saved templates, newest first. */
export function listTemplates(address: string): MilestoneTemplate[] {
  const store = storage();
  if (!store) return [];
  const raw = store.getItem(storageKey(address));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTemplate);
  } catch {
    return [];
  }
}

export interface SaveTemplateInput {
  name: string;
  asset: string;
  milestones: TemplateMilestone[];
}

/**
 * Save a milestone set. Returns the stored template, or `null` when the name is
 * empty, there is nothing to save, or the browser refuses to persist it.
 */
export function saveTemplate(
  address: string,
  input: SaveTemplateInput,
): MilestoneTemplate | null {
  const name = input.name.trim().slice(0, MAX_NAME);
  if (name.length === 0 || input.milestones.length === 0) return null;

  const templates = listTemplates(address);
  const template: MilestoneTemplate = {
    // Time plus position: unique enough for a picker, and unlike
    // `crypto.randomUUID` it does not depend on a browser API being present.
    id: `tpl-${Date.now().toString(36)}-${(templates.length + 1).toString(36)}`,
    name,
    asset: input.asset,
    milestones: input.milestones.map((milestone) => ({ amount: milestone.amount })),
    createdAt: new Date().toISOString(),
  };

  if (!write(address, [template, ...templates].slice(0, MAX_TEMPLATES))) return null;
  return template;
}

/** Remove one template. A no-op when storage is unavailable or the id is gone. */
export function deleteTemplate(address: string, id: string): void {
  const remaining = listTemplates(address).filter((template) => template.id !== id);
  write(address, remaining);
}
