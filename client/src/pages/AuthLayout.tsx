import type { ReactNode } from "react";
import { ThemeProvider } from "../theme/theme.tsx";

/**
 * Centered glass card for setup/sign-in/register. `color` previews the chrome from the color
 * picker before an account exists (dev doc §11.3: the pick seeds the palette).
 */
export function AuthLayout({
  title,
  color,
  children,
}: {
  title: string;
  color?: string | undefined;
  children: ReactNode;
}) {
  return (
    <ThemeProvider color={color}>
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
        <div>
          <h1 className="font-semibold text-3xl tracking-tight">Production Line</h1>
          <h2 className="mt-1 text-ink-muted text-lg">{title}</h2>
        </div>
        <div className="glass glass-in flex flex-col gap-5 rounded-2xl p-5 sm:p-6">{children}</div>
      </main>
    </ThemeProvider>
  );
}
