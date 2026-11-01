import { useSyncExternalStore } from "react";

export type Viewport = "mobile" | "tablet" | "desktop";

/** Dev doc §11.1 breakpoints: desktop ≥ 1024px, tablet ≥ 768px, mobile below. */
export const DESKTOP_QUERY = "(min-width: 64rem)";
export const TABLET_QUERY = "(min-width: 48rem)";

function current(): Viewport {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "desktop";
  if (window.matchMedia(DESKTOP_QUERY).matches) return "desktop";
  if (window.matchMedia(TABLET_QUERY).matches) return "tablet";
  return "mobile";
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const lists = [window.matchMedia(DESKTOP_QUERY), window.matchMedia(TABLET_QUERY)];
  for (const l of lists) l.addEventListener("change", onChange);
  return () => {
    for (const l of lists) l.removeEventListener("change", onChange);
  };
}

/**
 * Which layout to render. Exactly one layout is mounted at a time (rather than hiding the others
 * with CSS) so every control exists once in the DOM, for accessibility and for the tests.
 */
export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, current, () => "desktop");
}
