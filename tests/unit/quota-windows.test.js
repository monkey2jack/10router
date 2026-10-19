/**
 * 配额窗口 timeline math (src/shared/utils/quotaWindows.js). The endpoint page
 * draws exactly what these return, so which rows count as windows, where a
 * window starts, and what a view shows are pinned here.
 */
import { describe, it, expect } from "vitest";
import {
  buildTimelineRows,
  nextWindowEnd,
  rowWindows,
  startOfWeek,
  viewRange,
  windowKind,
  windowStart,
  DAY_MS,
  HOUR_MS,
} from "../../src/shared/utils/quotaWindows.js";

const NOW = new Date(2026, 8, 30, 12, 0).getTime(); // Wed 2026-09-30 12:00 local

describe("windowKind", () => {
  it("reads the window length from the row name (the window half for families)", () => {
    expect(windowKind({ name: "session (5h)", recurring: true, resetAt: "x" })).toBe("5h");
    expect(windowKind({ name: "weekly (7d)", recurring: true, resetAt: "x" })).toBe("week");
    expect(windowKind({ name: "Monthly Credits", recurring: true, resetAt: "x" })).toBe("month");
    expect(windowKind({ name: "Gemini Models · 5h Window", resetAt: "x" })).toBe("5h");
    expect(windowKind({ name: "Gemini Models · Weekly Window", resetAt: "x" })).toBe("week");
  });

  it("packs, gift grants and dateless rows are not windows", () => {
    expect(windowKind({ name: "Bonus Pack 3", recurring: false, resetAt: "2026-10-15" })).toBeNull();
    expect(windowKind({ name: "Monthly", recurring: true, giftPack: true, resetAt: "2026-10-01" })).toBeNull();
    expect(windowKind({ name: "Weekly", recurring: true })).toBeNull();
  });
});

describe("window geometry", () => {
  it("a window ends at its reset and starts one length before", () => {
    const reset = new Date(2026, 9, 6, 12, 55).getTime();
    expect(windowStart("week", reset)).toBe(reset - 7 * DAY_MS);
    expect(windowStart("5h", reset)).toBe(reset - 5 * HOUR_MS);
    expect(new Date(windowStart("month", new Date(2026, 9, 29).getTime())).getMonth()).toBe(8); // 09/29
  });

  it("month edges clamp to the target month instead of overflowing", () => {
    // setMonth(-1) on the 31st lands on the 31st of the shorter month — JS
    // rolls it into the next month, which draws a window starting AFTER it
    // ends. 2026 is not a leap year, so Mar 31 − 1mo is Feb 28.
    const mar31 = new Date(2026, 2, 31, 9, 0).getTime();
    const start = windowStart("month", mar31);
    expect(new Date(start).getMonth()).toBe(1);
    expect(new Date(start).getDate()).toBe(28);
    expect(start).toBeLessThan(mar31);
    // The forward chain clamps too: Mar 31 + 1mo is Apr 30, not May 1.
    const after = nextWindowEnd("month", mar31);
    expect(new Date(after).getMonth()).toBe(3);
    expect(new Date(after).getDate()).toBe(30);
    // And no window in the repeat chain is ever inverted.
    const wins = rowWindows(
      { resetAt: new Date(mar31).toISOString() },
      "month",
      mar31 - 40 * DAY_MS,
      mar31 + 100 * DAY_MS,
    );
    expect(wins.length).toBeGreaterThan(1);
    expect(wins.every((w) => w.start < w.end)).toBe(true);
  });

  it("repeats forward from the current window, never backward", () => {
    const reset = new Date(2026, 9, 1, 10, 40).getTime();
    const { start, end } = viewRange("week", NOW);
    const wins = rowWindows({ resetAt: new Date(reset).toISOString() }, "week", start, end);
    expect(wins[0]).toMatchObject({ current: true, end: reset });
    expect(wins[1].start).toBe(reset);
    expect(wins.every((w, i) => i === 0 || !w.current)).toBe(true);
    expect(wins.every((w) => w.end > start && w.start < end)).toBe(true);
  });

  it("week view is two weeks from Monday; hours view is the 24h around now", () => {
    const wk = viewRange("week", NOW);
    expect(new Date(wk.start).getDay()).toBe(1);
    expect(wk.start).toBe(startOfWeek(NOW));
    expect(wk.end - wk.start).toBe(14 * DAY_MS);
    expect(viewRange("week", NOW, 1).start - wk.start).toBe(7 * DAY_MS);
    // NOW is 12:00, so the hours axis is [00:00, 24:00) — now sits mid-track.
    const hr = viewRange("hours", NOW);
    expect(hr.end - hr.start).toBe(DAY_MS);
    expect(hr.start).toBe(NOW - 12 * HOUR_MS);
    expect(hr.end).toBe(NOW + 12 * HOUR_MS);
    expect(viewRange("hours", NOW, 1).start - hr.start).toBe(DAY_MS);
  });

  it("hours view stays hour-aligned when now has minutes", () => {
    const t = new Date(2026, 9, 1, 22, 44).getTime(); // 22:44
    const hr = viewRange("hours", t);
    expect(new Date(hr.start).getMinutes()).toBe(0);
    expect(new Date(hr.start).getHours()).toBe(10); // 10:00, 12h back floored
    expect(hr.end - hr.start).toBe(DAY_MS);
    expect(t - hr.start).toBeGreaterThanOrEqual(12 * HOUR_MS);
    expect(t - hr.start).toBeLessThan(13 * HOUR_MS); // flooring keeps now at mid-track ±1h
  });
});

describe("buildTimelineRows", () => {
  const conns = [
    {
      id: "ag",
      name: "ag",
      quotas: [
        { name: "Gemini Models · 5h Window", total: 100, used: 0, percentScale: true, resetAt: new Date(NOW + 3 * HOUR_MS).toISOString() },
        { name: "Gemini Models · Weekly Window", total: 100, used: 47, percentScale: true, resetAt: new Date(NOW + DAY_MS).toISOString() },
      ],
    },
    { id: "cb", name: "cb", quotas: [{ name: "Bonus Pack 1", recurring: false, total: 100, used: 0, resetAt: "2026-10-15" }] },
  ];

  it("skips accounts with no windows and lists every window as a chip", () => {
    const { start, end } = viewRange("week", NOW);
    const rows = buildTimelineRows(conns, { view: "week", rangeStart: start, rangeEnd: end });
    expect(rows.map((r) => r.id)).toEqual(["ag"]);
    expect(rows[0].chips.map((c) => [c.kind, c.pct])).toEqual([["5h", 100], ["week", 53]]);
  });

  it("each view draws only its own window kinds", () => {
    const wk = viewRange("week", NOW);
    const hr = viewRange("hours", NOW);
    expect(buildTimelineRows(conns, { view: "week", rangeStart: wk.start, rangeEnd: wk.end })[0].lanes.map((l) => l.kind)).toEqual(["week"]);
    expect(buildTimelineRows(conns, { view: "hours", rangeStart: hr.start, rangeEnd: hr.end })[0].lanes.map((l) => l.kind)).toEqual(["5h"]);
  });
});
