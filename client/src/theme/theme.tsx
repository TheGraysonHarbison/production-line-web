import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { DEFAULT_COLOR, derivePalette, type Palette, paletteVars } from "./palette.ts";

interface ThemeContextValue {
  /** The color the chrome is currently derived from (a preview wins over the saved color). */
  color: string;
  palette: Palette;
  /** Try a color on the live chrome (the Profile picker); `null` reverts to the saved color. */
  setPreview: (color: string | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function safePalette(color: string): Palette {
  try {
    return derivePalette(color);
  } catch {
    return derivePalette(DEFAULT_COLOR);
  }
}

/** Writes the palette onto :root (CSSOM, so the strict CSP needs no 'unsafe-inline'). */
export function applyPalette(palette: Palette, root: HTMLElement = document.documentElement) {
  for (const [name, value] of Object.entries(paletteVars(palette))) {
    root.style.setProperty(name, value);
  }
}

/**
 * Seeds the chrome from `color` (the signed-in user's pick, dev doc §11.3). Other users' colors
 * never flow through here; they tint only their own slots and avatars.
 */
export function ThemeProvider({
  color = DEFAULT_COLOR,
  children,
}: {
  color?: string | undefined;
  children: ReactNode;
}) {
  const [preview, setPreviewState] = useState<string | null>(null);
  const effective = preview ?? color;
  const palette = useMemo(() => safePalette(effective), [effective]);
  useLayoutEffect(() => {
    applyPalette(palette);
  }, [palette]);
  const setPreview = useCallback((c: string | null) => setPreviewState(c), []);
  const value = useMemo(
    () => ({ color: effective, palette, setPreview }),
    [effective, palette, setPreview],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}
