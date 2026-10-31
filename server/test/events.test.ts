import { describe, expect, it } from "vitest";
import { AppEvents } from "../src/events.js";

describe("AppEvents", () => {
  it("delivers typed events and supports unsubscribe", () => {
    const events = new AppEvents();
    const got: string[][] = [];
    const off = events.on("settings.updated", (p) => got.push(p.keys));
    events.emit("settings.updated", { keys: ["timezone"] });
    off();
    events.emit("settings.updated", { keys: ["images_enabled"] });
    expect(got).toEqual([["timezone"]]);
    expect(events.listenerCount("settings.updated")).toBe(0);
  });

  it("onAny sees every event with its name", () => {
    const events = new AppEvents();
    const seen: string[] = [];
    const off = events.onAny((name) => seen.push(name));
    events.emit("settings.updated", { keys: [] });
    events.emit("printer.deleted", {
      printer: { id: 1, name: "P", invisible: false, created_at: "2026-01-01T00:00:00.000Z" },
    });
    off();
    events.emit("settings.updated", { keys: [] });
    expect(seen).toEqual(["settings.updated", "printer.deleted"]);
  });
});
