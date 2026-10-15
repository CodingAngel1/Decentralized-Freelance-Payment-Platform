import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

/** Install a `navigator.clipboard` stub and return its `writeText` mock. */
function stubClipboard(writeText: () => Promise<void>) {
  const mock = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: mock },
    configurable: true,
  });
  return mock;
}

/** Install a `document.execCommand` stub (jsdom does not implement one). */
function stubExecCommand(impl: () => boolean) {
  const mock = vi.fn(impl);
  Object.defineProperty(document, "execCommand", { value: mock, configurable: true });
  return mock;
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
});

describe("copyText", () => {
  it("uses the async Clipboard API when the context has one", async () => {
    const writeText = stubClipboard(async () => undefined);

    await expect(copyText("GCLIENT")).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("GCLIENT");
  });

  it("falls back to execCommand when the API is missing", async () => {
    // A plain-http origin (LAN IP, container preview) exposes no clipboard.
    const exec = stubExecCommand(() => true);

    await expect(copyText("GCLIENT")).resolves.toBe(true);

    expect(exec).toHaveBeenCalledWith("copy");
    // The scratch textarea must not be left behind in the page.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back when the API exists but refuses (denied permission)", async () => {
    stubClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    const exec = stubExecCommand(() => true);

    await expect(copyText("GCLIENT")).resolves.toBe(true);

    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("reports failure instead of throwing when nothing can copy", async () => {
    // No Clipboard API and no execCommand — exactly what jsdom provides.
    await expect(copyText("GCLIENT")).resolves.toBe(false);
  });

  it("reports failure when execCommand itself fails", async () => {
    stubExecCommand(() => false);

    await expect(copyText("GCLIENT")).resolves.toBe(false);
  });

  it("still removes the scratch textarea when the copy throws", async () => {
    stubExecCommand(() => {
      throw new Error("boom");
    });

    await expect(copyText("GCLIENT")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
