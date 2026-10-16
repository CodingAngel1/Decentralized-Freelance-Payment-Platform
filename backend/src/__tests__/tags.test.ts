/**
 * tags.test.ts
 *
 * Issue #70: the curated skill taxonomy.
 *
 * The last check is the important one. The frontend renders the picker and the
 * dashboard filter from its own copy of this list (`frontend/src/lib/tags.ts`),
 * because a round-trip before the form is usable would be worse than a mirrored
 * constant. A slug that exists in only one copy would look selectable and then
 * be rejected by `createJobSchema`, so the two are compared here — this is the
 * side of the split that has Node's filesystem available to read the sibling.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSkillTag, MAX_JOB_TAGS, SKILL_TAG_SLUGS, SKILL_TAGS, tagLabel } from "../lib/tags";

/** Read a file from the repo root regardless of whether cwd is repo or backend. */
function repoFile(...segments: string[]): string {
  const cwd = process.cwd();
  const root = [cwd, path.resolve(cwd, "..")].find((dir) =>
    existsSync(path.join(dir, "docker-compose.yml")),
  );
  if (!root) throw new Error(`repo root not found from ${cwd}`);
  return readFileSync(path.join(root, ...segments), "utf8");
}

/** Pull `{ slug, label, category }` entries out of a tags module's source. */
function parseTags(source: string): { slug: string; label: string; category: string }[] {
  return [
    ...source.matchAll(
      /\{\s*slug:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*category:\s*"([^"]+)"\s*\}/g,
    ),
  ].map(([, slug, label, category]) => ({ slug, label, category }));
}

describe("skill tag taxonomy", () => {
  it("has unique, non-empty slugs", () => {
    expect(new Set(SKILL_TAG_SLUGS).size).toBe(SKILL_TAG_SLUGS.length);
    expect(SKILL_TAG_SLUGS.every((slug) => slug.length > 0)).toBe(true);
  });

  it("offers more tags than a single job may carry", () => {
    // Otherwise the cap would be untestable and the picker pointless.
    expect(SKILL_TAGS.length).toBeGreaterThan(MAX_JOB_TAGS);
  });

  it("recognises a curated slug and rejects anything else", () => {
    expect(isSkillTag("devops")).toBe(true);
    expect(isSkillTag("moon-shot")).toBe(false);
    expect(isSkillTag("")).toBe(false);
  });

  it("labels a curated slug, and falls back to the slug itself", () => {
    expect(tagLabel("devops")).toBe("DevOps & infrastructure");
    // Stored slugs outlive a label rename, and an unknown one should still be
    // readable rather than blank.
    expect(tagLabel("something-removed")).toBe("something-removed");
  });

  it("matches the frontend copy the picker renders from", () => {
    const frontend = repoFile("frontend", "src", "lib", "tags.ts");

    // Slugs, labels and categories must all line up: the backend copy is what
    // validation accepts, so any difference is a picker entry that cannot save.
    // (Regex 0 matches would compare [] against the real list and fail loudly.)
    expect(parseTags(frontend)).toEqual(SKILL_TAGS);
  });
});
