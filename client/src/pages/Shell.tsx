import { Outlet } from "react-router";
import { Dock } from "../components/Dock.tsx";
import { SlotEditor } from "../components/SlotEditor.tsx";
import { useMe } from "../lib/auth.tsx";
import { EditorProvider } from "../lib/editor.tsx";
import { useEventStream } from "../lib/stream.ts";

/** Authenticated frame: dock on the left (desktop) or top (narrow), content beside it. */
export function Shell() {
  const me = useMe();
  useEventStream(me.data?.id);
  if (!me.data) return null;
  return (
    <EditorProvider>
      <div className="flex min-h-dvh flex-col lg:flex-row">
        <Dock />
        <div className="min-w-0 flex-1 px-4 py-6">
          <Outlet />
        </div>
      </div>
      <SlotEditor />
    </EditorProvider>
  );
}
