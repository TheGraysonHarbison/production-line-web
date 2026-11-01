import { describe, expect, it } from "vitest";
import {
  contrast,
  derivePalette,
  hexToOklch,
  oklchToHex,
  paletteVars,
  WCAG_AA_TEXT,
} from "./palette.ts";

const SAMPLES = [
  // near-white, near-black, white, black
  "#fefefe",
  "#f8f8f0",
  "#010101",
  "#0a0a12",
  "#ffffff",
  "#000000",
  // highly saturated primaries and secondaries
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#ff00ff",
  "#00ffff",
  // grays
  "#808080",
  "#404040",
  "#c0c0c0",
  // ordinary picks
  "#4f9cff",
  "#7c5cff",
  "#e91e63",
  "#2e7d32",
  "#ff9800",
  "#6d4c41",
  "#9bd1e5",
  "#1a237e",
];

function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

describe("color conversions", () => {
  it("round-trips in-gamut colors through OKLCH", () => {
    for (const hex of ["#4f9cff", "#123456", "#abcdef", "#808080", "#ff9800"]) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });

  it("treats grays as achromatic", () => {
    expect(hexToOklch("#808080").c).toBe(0);
    expect(hexToOklch("#ffffff").c).toBe(0);
  });

  it("gamut-maps out-of-range chroma instead of producing garbage", () => {
    const vivid = oklchToHex({ l: 0.7, c: 0.4, h: 150 });
    expect(vivid).toMatch(/^#[0-9a-f]{6}$/);
    expect(hueDelta(hexToOklch(vivid).h, 150)).toBeLessThan(2);
  });

  it("computes WCAG contrast", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("rejects malformed input", () => {
    expect(() => derivePalette("blue")).toThrow();
    expect(() => derivePalette("#fff")).toThrow();
  });
});

describe("derivePalette", () => {
  for (const hex of SAMPLES) {
    it(`${hex}: every --on-accent meets ${WCAG_AA_TEXT}:1 and hue is kept`, () => {
      const p = derivePalette(hex);
      const base = hexToOklch(hex);
      for (const scheme of [p.light, p.dark]) {
        expect(contrast(scheme.onAccent, scheme.accent)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
        for (const v of [scheme.accent, scheme.accentSoft, scheme.accentStrong, scheme.onAccent]) {
          expect(v).toMatch(/^#[0-9a-f]{6}$/);
        }
        if (base.c > 0.03) {
          // Chromatic picks keep their hue on every derived surface (gamut mapping may trim chroma).
          expect(hueDelta(hexToOklch(scheme.accent).h, base.h)).toBeLessThan(3);
          expect(hueDelta(hexToOklch(scheme.accentStrong).h, base.h)).toBeLessThan(3);
        } else {
          // Near-gray picks stay near-gray rather than acquiring an inflated, random hue.
          expect(hexToOklch(scheme.accent).c).toBeLessThanOrEqual(base.c + 0.005);
        }
      }
      // Identity: the raw pick is never altered, and avatar text reads on it.
      expect(p.raw).toBe(hex);
      expect(contrast(p.onRaw, p.raw)).toBeGreaterThanOrEqual(WCAG_AA_TEXT);
    });
  }

  it("nudges very light and very dark picks into the surface band but keeps raw", () => {
    const light = derivePalette("#fefefe");
    expect(hexToOklch(light.light.accent).l).toBeLessThan(0.8);
    expect(light.raw).toBe("#fefefe");
    const dark = derivePalette("#010101");
    expect(hexToOklch(dark.dark.accent).l).toBeGreaterThan(0.5);
    expect(dark.raw).toBe("#010101");
  });

  it("soft tints are light in light mode and dark in dark mode", () => {
    const p = derivePalette("#e91e63");
    expect(hexToOklch(p.light.accentSoft).l).toBeGreaterThan(0.9);
    expect(hexToOklch(p.dark.accentSoft).l).toBeLessThan(0.4);
  });

  it("is deterministic", () => {
    expect(derivePalette("#7c5cff")).toEqual(derivePalette("#7c5cff"));
  });

  it("exposes both schemes as CSS variables", () => {
    const vars = paletteVars(derivePalette("#4f9cff"));
    expect(Object.keys(vars).sort()).toEqual(
      [
        "--accent-d",
        "--accent-l",
        "--accent-raw",
        "--accent-soft-d",
        "--accent-soft-l",
        "--accent-strong-d",
        "--accent-strong-l",
        "--on-accent-d",
        "--on-accent-l",
        "--on-accent-raw",
      ].sort(),
    );
    expect(vars["--accent-raw"]).toBe("#4f9cff");
  });
});
