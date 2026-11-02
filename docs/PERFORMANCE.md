# Performance sanity (roadmap Phase 10)

No hard targets (dev doc §18); these numbers are a baseline to compare against after changes.
Reproduce with `node scripts/perf-seed.mjs` (API timings) and the throttled browser run described
below. Measured 2026-11-01 on the dev host (desktop x86-64, Chromium via Playwright, production
build). Chromium's CPU throttle at 4× to 6× is a rough stand-in for a Raspberry Pi 4/5; measure
on a real Pi before relying on it.

## Data set

10 printers × 500 slots each over 62 days (10 days of history, 52 ahead), 90-minute slots about
three hours apart: 5,000 slots, roughly 8 per printer per day. That is far denser than a shared
home print queue; it is the "will it fall over" case, not the expected one.

## API (`GET /api/slots?from=&to=`), warm, median of 5

| Query | Rows | Median |
|---|---|---|
| 62-day calendar window (the maximum the API allows) | 4,190 | 40–47 ms |
| 31-day timeline strip | 2,500 | 25–27 ms |
| One day | 80 | 1–2 ms |

The range query uses the `slots_range` index and hydrates users, printers, and images in three
batched statements per request (`SlotsService.hydrate`). Nothing here needed changing.

## Timeline strip in the browser (1280×800, 10 printers, 2,500 slots in range)

| | Cards in DOM | First paint of the strip | Step a day (instant jump) | Open the editor |
|---|---|---|---|---|
| Before this phase, unthrottled | 2,430 | 846 ms | 857 ms | 962 ms |
| Before this phase, 4× throttle | 2,430 | 3.3 s | 3.4 s | 3.6 s |
| After, unthrottled | 160 | 223 ms | 295 ms | 511 ms |
| After, 4× throttle | 160 | 1.6 s | 1.1 s | 1.1 s |
| After, 6× throttle | 160 | 1.9 s | 1.3 s | 1.5 s |

"First paint" is from navigation to the first card after the slot query returns, so it includes
the 2,500-row fetch. "Step a day" is the Next day button with reduced motion (no smooth scroll),
measured to the next animation frame. "Open the editor" is a click on the first card until the
dialog's heading is visible.

What changed (`client/src/components/Timeline.tsx`, `SlotCard.tsx`):

1. **Card windowing.** Lanes mount only the slots that overlap the scrolled viewport plus a day
   on each side, re-measured in 12-hour steps as you scroll. 2,430 cards became 160 for the same
   view. A slot being dragged stays mounted wherever it is.
2. **Memoised lanes with stable handlers.** Each printer lane is a `memo` component; pointer
   handlers read live values through a ref, so a drag re-renders only its own lane, and page state
   (heading, notices, the editor opening) never re-renders cards.
3. **No per-card backdrop blur.** Blurring every card made the compositor repaint all of them on
   each scroll frame; the lane surface is already glass. Cards also use
   `content-visibility: auto` so the browser skips painting the few that are mounted off-screen.

Remaining cost at 4× is dominated by parsing the 2,500-row response and React's first render of
the strip chrome (750 hour ticks). A typical installation (a few printers, a couple of slots a
day) stays well under 100 ms for every step above even throttled.
