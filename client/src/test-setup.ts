import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-cleans with Vitest globals enabled; do it explicitly.
afterEach(() => {
  cleanup();
});

// jsdom has no EventSource; the shell opens one, so provide an inert stand-in for unit tests.
class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly url: string;
  readyState = FakeEventSource.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor(url: string) {
    super();
    this.url = url;
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}
if (typeof globalThis.EventSource === "undefined") {
  (globalThis as unknown as { EventSource: typeof FakeEventSource }).EventSource = FakeEventSource;
}
