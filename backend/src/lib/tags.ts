/**
 * tags.ts
 *
 * The curated skill/category taxonomy a job can be tagged with (issue #70).
 *
 * Kept free of any `config`/Prisma import so it is unit testable without
 * environment variables, and so both the job-creation schema and the list route
 * can share it.
 *
 * Mirrored in `frontend/src/lib/tags.ts` — the frontend renders the picker from
 * its own copy so it does not need a round-trip before the form is usable
 * (the same trade-off `lib/assets.ts` makes). Adding a tag means adding it in
 * both files; the backend copy is canonical because it is what validation
 * accepts.
 *
 * Contributor Notes:
 * - Slugs are what gets stored and queried (`?tag=web-development`); labels are
 *   display-only, so renaming a label never invalidates stored data.
 * - A second backend copy would be the place to look first if a tag is
 *   rejected by `createJobSchema` but appears in the frontend picker.
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

/** Every accepted slug, in list order. */
export const SKILL_TAG_SLUGS: string[] = SKILL_TAGS.map((tag) => tag.slug);

const SKILL_TAG_SET = new Set(SKILL_TAG_SLUGS);

/** Is `slug` one of the curated tags? */
export function isSkillTag(slug: string): boolean {
  return SKILL_TAG_SET.has(slug);
}

/** The display label for a slug, falling back to the slug itself. */
export function tagLabel(slug: string): string {
  return SKILL_TAGS.find((tag) => tag.slug === slug)?.label ?? slug;
}

/** The most tags a single job may carry. */
export const MAX_JOB_TAGS = 8;
