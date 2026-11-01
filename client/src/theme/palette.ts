/**
 * Palette derivation (dev doc §11.3): the user's free-form color → OKLCH → accent tokens with the
 * hue kept fixed. Pure functions only, so the whole thing is unit-testable without a DOM.
 *
 * Color math follows Björn Ottosson's OKLab reference (sRGB D65). Results are returned as hex so
 * every browser that can render the app can render the palette, and so contrast can be verified
 * numerically in tests.
 */

export interface Oklch {
  /** Lightness 0..1 */
  l: number;
  /** Chroma 0..~0.4 */
  c: number;
  /** Hue in degrees 0..360 */
  h: number;
}

export interface SchemePalette {
  /** The chrome color: buttons, active tabs, focus rings. Nudged into a usable lightness band. */
  accent: string;
  /** A faint tint for backgrounds and hover states. */
  accentSoft: string;
  /** A deeper/brighter variant for hover and pressed states. */
  accentStrong: string;
  /** Near-black or near-white, whichever reads better on `accent`; always ≥ 4.5:1. */
  onAccent: string;
}

export interface Palette {
  /** The untouched pick, for identity: avatar, slot bars, calendar bars. */
  raw: string;
  /** Text color that reads on the raw pick (not nudged), for avatars. */
  onRaw: string;
  light: SchemePalette;
  dark: SchemePalette;
}

export const WCAG_AA_TEXT = 4.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ---------- sRGB ---------- */

export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) throw new Error(`Not a 6-digit hex color: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
}

/** WCAG relative luminance of a hex color. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio between two hex colors (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- OKLab / OKLCH ---------- */

function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = parseHex(hex);
  const [L, a, bb] = linearToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
  const c = Math.hypot(a, bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  // Achromatic colors have no meaningful hue; pin it so derived tints stay neutral.
  return { l: clamp(L, 0, 1), c: c < 1e-4 ? 0 : c, h: c < 1e-4 ? 0 : h };
}

function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  return oklabToLinear(l, c * Math.cos(rad), c * Math.sin(rad));
}

function inGamut(rgb: [number, number, number]): boolean {
  const eps = 1e-6;
  return rgb.every((v) => v >= -eps && v <= 1 + eps);
}

/**
 * OKLCH → hex. Colors outside sRGB are brought in by reducing chroma (hue and lightness fixed),
 * which is the CSS Color 4 recommendation for preserving the "same color, less vivid" intent.
 */
export function oklchToHex(color: Oklch): string {
  const l = clamp(color.l, 0, 1);
  let lo = 0;
  let hi = color.c;
  let rgb = oklchToLinear({ l, c: hi, h: color.h });
  if (!inGamut(rgb)) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const candidate = oklchToLinear({ l, c: mid, h: color.h });
      if (inGamut(candidate)) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinear({ l, c: lo, h: color.h });
  }
  return toHex([
    linearToSrgb(clamp(rgb[0], 0, 1)),
    linearToSrgb(clamp(rgb[1], 0, 1)),
    linearToSrgb(clamp(rgb[2], 0, 1)),
  ]);
}

/* ---------- derivation ---------- */

/** Text candidates: hue-tinted near-black and near-white, so "white text" still feels on-brand. */
function textCandidates(h: number): { dark: string; light: string } {
  return {
    dark: oklchToHex({ l: 0.16, c: 0.02, h }),
    light: oklchToHex({ l: 0.985, c: 0.008, h }),
  };
}

/**
 * Best of two text candidates on `bg`, by contrast. Tinted candidates (default) give on-brand text
 * for surfaces whose lightness we control; pure black/white are for colors we must not alter,
 * because one of those two always reaches 4.5:1 on any background.
 */
export function pickOn(bg: string, h: number, pure = false): { color: string; ratio: number } {
  const { dark, light } = pure ? { dark: "#000000", light: "#ffffff" } : textCandidates(h);
  const cd = contrast(dark, bg);
  const cl = contrast(light, bg);
  return cd >= cl ? { color: dark, ratio: cd } : { color: light, ratio: cl };
}

/**
 * Nudge lightness, stepping away from the mid band where neither near-black nor near-white reaches
 * 4.5:1, until a text candidate passes. Hue and chroma are kept; chroma may be reduced by gamut
 * mapping. Returns the final accent and its text color.
 */
function settleAccent(base: Oklch, prefer: "lighter" | "darker"): { accent: string; on: string } {
  const step = prefer === "lighter" ? 0.01 : -0.01;
  let l = base.l;
  for (let i = 0; i < 100; i++) {
    const accent = oklchToHex({ l, c: base.c, h: base.h });
    const on = pickOn(accent, base.h);
    if (on.ratio >= WCAG_AA_TEXT) return { accent, on: on.color };
    l = clamp(l + step, 0, 1);
  }
  // Unreachable in practice (pure white/black always pass), but never return an unsafe pair.
  const accent = oklchToHex({ l: prefer === "lighter" ? 1 : 0, c: 0, h: base.h });
  return { accent, on: pickOn(accent, base.h).color };
}

function deriveScheme(base: Oklch, scheme: "light" | "dark"): SchemePalette {
  // Surface-friendly lightness bands (dev doc §11.3: very light/dark picks are nudged for UI).
  const band = scheme === "light" ? ([0.4, 0.72] as const) : ([0.58, 0.84] as const);
  const l = clamp(base.l, band[0], band[1]);
  // Keep chroma meaningful but not neon; near-grays stay near-gray instead of being inflated.
  const c = base.c < 0.03 ? base.c : clamp(base.c, 0.06, 0.2);
  const prefer = scheme === "light" ? "darker" : "lighter";
  const settled = settleAccent({ l, c, h: base.h }, prefer);
  const accentL = hexToOklch(settled.accent).l;
  const strong = oklchToHex({
    l: scheme === "light" ? accentL - 0.1 : accentL + 0.08,
    c,
    h: base.h,
  });
  const soft = oklchToHex({
    l: scheme === "light" ? 0.94 : 0.3,
    c: base.c === 0 ? 0 : Math.min(c, scheme === "light" ? 0.05 : 0.07),
    h: base.h,
  });
  return { accent: settled.accent, accentSoft: soft, accentStrong: strong, onAccent: settled.on };
}

/** Everything the theme needs from one hex pick. Throws on malformed input. */
export function derivePalette(hex: string): Palette {
  const base = hexToOklch(hex);
  const raw = toHex(parseHex(hex));
  return {
    raw,
    onRaw: pickOn(raw, base.h, true).color,
    light: deriveScheme(base, "light"),
    dark: deriveScheme(base, "dark"),
  };
}

/** CSS custom properties for `:root`, both schemes; index.css picks per `prefers-color-scheme`. */
export function paletteVars(p: Palette): Record<string, string> {
  return {
    "--accent-raw": p.raw,
    "--on-accent-raw": p.onRaw,
    "--accent-l": p.light.accent,
    "--accent-soft-l": p.light.accentSoft,
    "--accent-strong-l": p.light.accentStrong,
    "--on-accent-l": p.light.onAccent,
    "--accent-d": p.dark.accent,
    "--accent-soft-d": p.dark.accentSoft,
    "--accent-strong-d": p.dark.accentStrong,
    "--on-accent-d": p.dark.onAccent,
  };
}

export const DEFAULT_COLOR = "#4f9cff";
