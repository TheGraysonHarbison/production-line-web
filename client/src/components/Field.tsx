import type { ReactNode } from "react";

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="font-medium text-sm">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-danger text-sm" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-ink-muted text-sm">{hint}</p>
      ) : null}
    </div>
  );
}

/* Shared control styles, token-driven so light/dark and the user's accent flow through. */
export const inputClass =
  "min-h-11 rounded-lg border border-line-strong bg-canvas/70 px-3 py-2 text-base text-ink placeholder:text-ink-muted focus:border-accent";
export const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 font-medium text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-50 disabled:hover:bg-accent";
export const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line-strong bg-canvas/40 px-4 py-2 font-medium text-ink transition-colors hover:bg-accent-soft disabled:opacity-50";
export const dangerButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-danger px-4 py-2 font-medium text-white transition-colors disabled:opacity-50";
/** A text-style button or link that still clears the 44px touch target on touch layouts. */
export const linkButtonClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-1 text-accent underline underline-offset-2 hover:text-accent-strong lg:min-h-0 lg:min-w-0";
