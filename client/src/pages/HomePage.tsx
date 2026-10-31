import { useMe } from "../lib/auth.tsx";

export function HomePage() {
  const me = useMe();
  return (
    <main className="mx-auto max-w-xl">
      <h2 className="font-semibold text-2xl">Hello, {me.data?.username}</h2>
      <p className="mt-2 opacity-80">Printers and scheduling arrive in the next phases.</p>
    </main>
  );
}
