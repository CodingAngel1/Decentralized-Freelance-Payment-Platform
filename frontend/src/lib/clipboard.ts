/**
 * clipboard.ts
 *
 * Copy text to the clipboard, with a fallback for contexts where the async
 * Clipboard API is not available.
 *
 * Contributor Notes:
 * - `navigator.clipboard` only exists in a secure context. The Vercel
 *   deployment and `localhost` get it, but a plain-http origin (a LAN IP or a
 *   container preview) does not, so the legacy `execCommand("copy")` path is
 *   kept for those.
 * - This never throws. A failed copy is not an error worth an exception: the
 *   caller shows a hint and the address is still on screen to select by hand.
 */

/** Copy `text`, returning whether it made it to the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Denied permission, or an insecure context that still exposes the API.
      // Fall through to the legacy path before giving up.
    }
  }
  return legacyCopy(text);
}

/**
 * `document.execCommand("copy")` on a temporary, off-screen textarea.
 *
 * Deprecated, but it is the only synchronous path and the only one available
 * without a secure context. jsdom does not implement it, hence the `typeof`
 * guard rather than a try/catch around a call that may not exist.
 */
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return false;
  }

  const area = document.createElement("textarea");
  area.value = text;
  // Keep it out of the tab order and out of view while it is selected.
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  document.body.appendChild(area);

  try {
    area.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
