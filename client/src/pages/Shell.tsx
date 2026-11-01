import { useState } from "react";
import { Outlet } from "react-router";
import { Dock } from "../components/Dock.tsx";
import { MobileHeader, TabBar } from "../components/MobileChrome.tsx";
import { PrintersDrawer } from "../components/PrintersDrawer.tsx";
import { Rail } from "../components/Rail.tsx";
import { SlotEditor } from "../components/SlotEditor.tsx";
import { Toasts } from "../components/Toasts.tsx";
import { useMe } from "../lib/auth.tsx";
import { EditorProvider } from "../lib/editor.tsx";
import { useEventStream } from "../lib/stream.ts";
import { useViewport } from "../lib/viewport.ts";
import { ThemeProvider } from "../theme/theme.tsx";

/**
 * Authenticated frame (dev doc §11.1). Exactly one chrome is mounted per viewport: the desktop
 * dock, the tablet icon rail with a printer drawer, or the mobile header + bottom tab bar.
 */
export function Shell() {
  const me = useMe();
  useEventStream(me.data?.id);
  const viewport = useViewport();
  const [printersOpen, setPrintersOpen] = useState(false);
  if (!me.data) return null;

  return (
    <ThemeProvider color={me.data.color}>
      <EditorProvider>
        {viewport === "desktop" ? (
          <div className="flex min-h-dvh">
            <Dock />
            <div className="min-w-0 flex-1 px-6 py-6">
              <Outlet />
            </div>
          </div>
        ) : viewport === "tablet" ? (
          <div className="flex min-h-dvh">
            <Rail onOpenPrinters={() => setPrintersOpen(true)} />
            <div className="min-w-0 flex-1 px-4 py-5">
              <Outlet />
            </div>
            <PrintersDrawer open={printersOpen} onClose={() => setPrintersOpen(false)} />
          </div>
        ) : (
          <div className="flex min-h-dvh flex-col">
            <MobileHeader />
            <div
              className="min-w-0 flex-1 px-4 py-4"
              style={{ paddingBottom: "calc(var(--tabbar-height) + 1rem)" }}
            >
              <Outlet />
            </div>
            <TabBar />
          </div>
        )}
        <SlotEditor sheet={viewport === "mobile"} />
        <Toasts />
      </EditorProvider>
    </ThemeProvider>
  );
}
