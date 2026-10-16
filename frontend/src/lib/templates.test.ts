/**
 * templates.test.ts
 *
 * Issue #75: a client can save a milestone set as a template and re-apply it.
 * The store is browser storage, so these run against jsdom's `localStorage`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteTemplate, listTemplates, saveTemplate } from "./templates";

const CLIENT = "GCLIENT";
const OTHER = "GOTHER";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("saveTemplate", () => {
  it("saves a milestone set and lists it back, newest first", () => {
    const first = saveTemplate(CLIENT, {
      name: "Retainer",
      asset: "XLM",
      milestones: [{ amount: "1.5" }, { amount: "2.5" }],
    });
    const second = saveTemplate(CLIENT, {
      name: "Audit",
      asset: "USDC",
      milestones: [{ amount: "10" }],
    });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    const templates = listTemplates(CLIENT);
    expect(templates.map((t) => t.name)).toEqual(["Audit", "Retainer"]);
    // The asset travels with the set so its decimals are restored too.
    expect(templates[1]).toMatchObject({
      name: "Retainer",
      asset: "XLM",
      milestones: [{ amount: "1.5" }, { amount: "2.5" }],
    });
  });

  it("trims the name and truncates it to what the picker can show", () => {
    const saved = saveTemplate(CLIENT, {
      name: `  ${"x".repeat(100)}  `,
      asset: "XLM",
      milestones: [{ amount: "1" }],
    });

    expect(saved?.name).toHaveLength(60);
    expect(saved?.name).toBe("x".repeat(60));
  });

  it("refuses an unnamed or empty set", () => {
    expect(
      saveTemplate(CLIENT, { name: "   ", asset: "XLM", milestones: [{ amount: "1" }] }),
    ).toBeNull();
    expect(saveTemplate(CLIENT, { name: "Nothing", asset: "XLM", milestones: [] })).toBeNull();
    expect(listTemplates(CLIENT)).toEqual([]);
  });

  it("keeps each client's templates to themselves", () => {
    saveTemplate(CLIENT, { name: "Retainer", asset: "XLM", milestones: [{ amount: "1" }] });

    expect(listTemplates(OTHER)).toEqual([]);
    expect(listTemplates(CLIENT)).toHaveLength(1);
  });

  it("caps the list so the picker stays usable", () => {
    for (let i = 0; i < 25; i++) {
      saveTemplate(CLIENT, { name: `Set ${i}`, asset: "XLM", milestones: [{ amount: "1" }] });
    }

    const templates = listTemplates(CLIENT);
    expect(templates).toHaveLength(20);
    // The newest survived the cap.
    expect(templates[0].name).toBe("Set 24");
  });
});

describe("deleteTemplate", () => {
  it("removes only the named template", () => {
    const keep = saveTemplate(CLIENT, {
      name: "Retainer",
      asset: "XLM",
      milestones: [{ amount: "1" }],
    });
    const drop = saveTemplate(CLIENT, {
      name: "Audit",
      asset: "XLM",
      milestones: [{ amount: "2" }],
    });

    deleteTemplate(CLIENT, drop!.id);

    const remaining = listTemplates(CLIENT);
    expect(remaining.map((t) => t.id)).toEqual([keep!.id]);
  });

  it("is a no-op for an unknown id", () => {
    saveTemplate(CLIENT, { name: "Retainer", asset: "XLM", milestones: [{ amount: "1" }] });

    deleteTemplate(CLIENT, "tpl-nope");

    expect(listTemplates(CLIENT)).toHaveLength(1);
  });
});

describe("listTemplates with damaged storage", () => {
  it("degrades to no templates instead of throwing", () => {
    const key = "stellar-freelance:templates:v1:GCLIENT";
    for (const raw of ["not json", "{}", '"a string"', "[1,2,3]", '[{"id":1}]']) {
      window.localStorage.setItem(key, raw);
      expect(listTemplates(CLIENT)).toEqual([]);
    }
  });

  it("keeps the entries that are still well-formed", () => {
    const good = saveTemplate(CLIENT, {
      name: "Retainer",
      asset: "XLM",
      milestones: [{ amount: "1" }],
    });
    const key = "stellar-freelance:templates:v1:GCLIENT";
    window.localStorage.setItem(key, JSON.stringify([good, { id: "broken" }]));

    expect(listTemplates(CLIENT).map((t) => t.name)).toEqual(["Retainer"]);
  });
});
