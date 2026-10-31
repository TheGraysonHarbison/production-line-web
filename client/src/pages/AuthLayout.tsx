import type { ReactNode } from "react";

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
      <div>
        <h1 className="font-semibold text-3xl tracking-tight">Production Line</h1>
        <h2 className="mt-1 text-lg opacity-80">{title}</h2>
      </div>
      {children}
    </main>
  );
}
