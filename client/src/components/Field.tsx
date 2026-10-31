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
        <p className="text-red-600 text-sm dark:text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm opacity-70">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "rounded-md border border-neutral-300 bg-white px-3 py-2 text-base dark:border-neutral-700 dark:bg-neutral-900";
export const buttonClass =
  "rounded-md bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900";
