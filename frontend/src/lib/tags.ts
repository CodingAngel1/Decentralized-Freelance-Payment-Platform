/**
 * tags.ts
 *
 * The curated skill/category taxonomy a job can be tagged with (issue #70).
 *
 * Mirrors `backend/src/lib/tags.ts`, which is canonical: it is the list
 * `createJobSchema` validates against and what `GET /api/jobs/tags` returns.
 * The picker renders from this local copy so it is usable immediately instead
 * of after a round-trip (the same trade-off `lib/assets.ts` makes). Adding a
 * tag means adding it here and on the backend.
 *
 * Slugs are what the API stores and filters on; labels are display only.
 */

export interface SkillTag {
  /** Stable identifier stored on the job and used as the `?tag=` filter. */
  slug: string;
  /** Human-readable name shown in the UI. */
  label: string;
  /** Grouping used to lay the picker out. */
  category: string;
}

export const SKILL_TAGS: SkillTag[] = [
  { slug: "web-development", label: "Web development", category: "Development" },
  { slug: "mobile-development", label: "Mobile development", category: "Development" },
  { slug: "backend-development", label: "Backend & APIs", category: "Development" },
  { slug: "devops", label: "DevOps & infrastructure", category: "Development" },
  { slug: "smart-contracts", label: "Smart contracts", category: "Blockchain" },
  { slug: "security-review", label: "Security review", category: "Blockchain" },
  { slug: "data-analysis", label: "Data analysis", category: "Data" },
  { slug: "machine-learning", label: "Machine learning", category: "Data" },
  { slug: "ui-ux-design", label: "UI/UX design", category: "Design" },
  { slug: "brand-design", label: "Brand & graphics", category: "Design" },
  { slug: "technical-writing", label: "Technical writing", category: "Content" },
  { slug: "content-writing", label: "Content writing", category: "Content" },
  { slug: "translation", label: "Translation", category: "Content" },
  { slug: "video-editing", label: "Video editing", category: "Media" },
  { slug: "product-management", label: "Product management", category: "Business" },
  { slug: "marketing", label: "Marketing", category: "Business" },
];

/** The most tags a single job may carry (mirrors the backend cap). */
export const MAX_JOB_TAGS = 8;

/** The display label for a slug, falling back to the slug itself. */
export function tagLabel(slug: string): string {
  return SKILL_TAGS.find((tag) => tag.slug === slug)?.label ?? slug;
}

/** The curated tags grouped into their categories, in declaration order. */
export function tagsByCategory(): { category: string; tags: SkillTag[] }[] {
  const groups: { category: string; tags: SkillTag[] }[] = [];
  for (const tag of SKILL_TAGS) {
    const group = groups.find((entry) => entry.category === tag.category);
    if (group) group.tags.push(tag);
    else groups.push({ category: tag.category, tags: [tag] });
  }
  return groups;
}
