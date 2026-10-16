/**
 * tags.test.ts
 *
 * Issue #70: the curated skill taxonomy the picker and the filter render from.
 *
 * The guard that this copy still matches the backend's canonical list — the one
 * the API validates against — lives in `backend/src/__tests__/tags.test.ts`,
 * because reading the sibling file needs Node APIs the frontend build does not
 * type-check against.
 */

import { describe, expect, it } from "vitest";
import { MAX_JOB_TAGS, SKILL_TAGS, tagLabel, tagsByCategory } from "./tags";

describe("skill tags", () => {
  it("has unique, non-empty slugs", () => {
    const slugs = SKILL_TAGS.map((tag) => tag.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs.every((slug) => slug.length > 0)).toBe(true);
  });

  it("offers more tags than a single job may carry", () => {
    expect(SKILL_TAGS.length).toBeGreaterThan(MAX_JOB_TAGS);
  });

  it("labels a curated slug", () => {
    expect(tagLabel("web-development")).toBe("Web development");
  });

  it("falls back to the slug itself for an unknown tag", () => {
    // Stored slugs outlive a label rename, and an unknown one should still be
    // readable rather than blank.
    expect(tagLabel("something-removed")).toBe("something-removed");
  });

  it("groups tags by category in declaration order", () => {
    const groups = tagsByCategory();

    expect(groups[0]).toMatchObject({ category: "Development" });
    expect(groups.map((group) => group.category)).toEqual([
      "Development",
      "Blockchain",
      "Data",
      "Design",
      "Content",
      "Media",
      "Business",
    ]);
    // Every tag appears exactly once across the groups.
    const grouped = groups.flatMap((group) => group.tags.map((tag) => tag.slug));
    expect(grouped).toEqual(SKILL_TAGS.map((tag) => tag.slug));
  });

});
