import { useQuery } from "@tanstack/react-query";
import { Route, Routes } from "react-router";
import { fetchMeta } from "./api.ts";

function Home() {
  const meta = useQuery({ queryKey: ["meta"], queryFn: fetchMeta });

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-semibold tracking-tight">Production Line</h1>
      <p className="opacity-80">Shared 3D printer scheduling for your LAN.</p>
      <p data-testid="meta-status" className="text-sm opacity-70">
        {meta.isPending && "Connecting to server…"}
        {meta.isError && `Server unreachable: ${meta.error.message}`}
        {meta.isSuccess && `Server timezone: ${meta.data.timezone}`}
      </p>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/*" element={<Home />} />
    </Routes>
  );
}
