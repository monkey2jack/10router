/**
 * Quota windows on a time axis — pure, DOM-free (the endpoint page's
 * "配额窗口" timeline, QuotaWindowTimeline.js).
 *
 * A cycle row (resets, has a resetAt) is one window of a known length ending at
 * resetAt: 5h / daily / weekly / monthly, read from the row's name like every
 * other quota surface does. The current window is [resetAt − length, resetAt];
 * the ones after it repeat every length. One-shot packs have no length — they
 * are not windows and stay off the axis.
 */
import { isResettingRow, percentOf, splitFamilyWindow } from "./quotaRows.js";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

const PERIODS = [
  { re: /5h|five[\s_-]?hour|session|rolling|滚动|5\s*小时/i, ms: 5 * HOUR_MS, key: "5h" },
  { re: /daily|\bday\b|24h|每日|每天/i, ms: DAY_MS, key: "day" },
  { re: /week|7d|周/i, ms: 7 * DAY_MS, key: "week" },
  { re: /month|月/i, ms: null, key: "month" }, // calendar month, see windowStart
];

/** "5h" | "day" | "week" | "month" | null for a row that is not a window. */
export function windowKind(row) {
  // A monthly GRANT (CodeBuddy `giftPack`) is a pack that expires, not a plan
  // window; per-pack breakdown rows are never on the axis either.
  if (row?.giftPack === true || row?.detailOnly === true) return null;
  if (!isResettingRow(row) || !row?.resetAt) return null;
  const name = String(row?.name || "");
  // "Gemini Models · 5h Window" — judge the window half, not the family.
  const judged = splitFamilyWindow(name)?.window || name;
  for (const p of PERIODS) if (p.re.test(judged)) return p.key;
  return null;
}

/**
 * Shift a timestamp by whole calendar months, clamping the day-of-month:
 * Mar 31 − 1 month is Feb 28/29, never the JS overflow Mar 3 — that would
 * produce a window starting after it ends and draw a misplaced bar.
 */
function addMonths(t, delta) {
  const d = new Date(t);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  const daysInTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, daysInTarget));
  return d.getTime();
}

/** Start of the window that ends at `end` (a calendar month back for monthly). */
export function windowStart(kind, end) {
  const t = new Date(end).getTime();
  if (kind === "month") return addMonths(t, -1);
  const p = PERIODS.find((x) => x.key === kind);
  return p?.ms ? t - p.ms : NaN;
}

/** End of the window after the one ending at `end`. */
export function nextWindowEnd(kind, end) {
  const t = new Date(end).getTime();
  if (kind === "month") return addMonths(t, 1);
  const p = PERIODS.find((x) => x.key === kind);
  return p?.ms ? t + p.ms : NaN;
}

/** Views: which window kinds each one draws, and how wide / how far a step goes. */
export const VIEWS = {
  week: { kinds: ["day", "week", "month"], spanMs: 14 * DAY_MS, stepMs: 7 * DAY_MS, tickMs: DAY_MS },
  hours: { kinds: ["5h"], spanMs: DAY_MS, stepMs: DAY_MS, tickMs: HOUR_MS },
};

/** Monday 00:00 (local) of the week containing `t`. */
export function startOfWeek(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // Mon = 0
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

export function startOfHour(t) {
  const d = new Date(t);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/**
 * [start, end) of a view, `offset` steps away from the one containing `now`.
 * The hours view is the 24h AROUND now ([now−12h, now+12h), floored to the
 * hour) — a calendar day buries "now" at the right edge by evening, which is
 * exactly when the 5h window matters.
 */
export function viewRange(view, now, offset = 0) {
  const v = VIEWS[view] || VIEWS.week;
  const base = view === "hours" ? startOfHour(now - 12 * HOUR_MS) : startOfWeek(now);
  const start = base + offset * v.stepMs;
  return { start, end: start + v.spanMs };
}

/**
 * The windows of one row that overlap [rangeStart, rangeEnd): the current one
 * (with its remaining share) and the repeats after it. A window is never
 * inferred BEFORE the current one — we do not know what past windows held.
 */
export function rowWindows(row, kind, rangeStart, rangeEnd, maxRepeats = 60) {
  const out = [];
  let end = new Date(row?.resetAt).getTime();
  let start = windowStart(kind, end);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return out;
  for (let i = 0; i <= maxRepeats && start < rangeEnd; i += 1) {
    if (end > rangeStart) out.push({ start, end, current: i === 0 });
    const next = nextWindowEnd(kind, end);
    if (!Number.isFinite(next)) break;
    start = end; // the next window begins where this one resets
    end = next;
  }
  return out;
}

/**
 * Timeline rows for the given quota overview (/api/usage/quotas connections).
 * Each connection with at least one window of the view's kinds becomes a row
 * with one lane per window row; every window row (any kind) is also listed as
 * a chip so the 5h numbers stay visible in the week view and vice versa.
 */
export function buildTimelineRows(connections = [], { view = "week", rangeStart, rangeEnd } = {}) {
  const kinds = (VIEWS[view] || VIEWS.week).kinds;
  const rows = [];
  for (const conn of connections || []) {
    const quotas = Array.isArray(conn?.quotas) ? conn.quotas : [];
    const windowRows = quotas
      .map((q) => ({ q, kind: windowKind(q) }))
      .filter((x) => x.kind);
    if (windowRows.length === 0) continue;
    const chips = windowRows.map(({ q, kind }) => ({ name: q.name, kind, pct: Math.round(percentOf(q)) }));
    const lanes = windowRows
      .filter(({ kind }) => kinds.includes(kind))
      .map(({ q, kind }) => ({
        name: q.name,
        kind,
        pct: percentOf(q),
        resetAt: q.resetAt,
        windows: rowWindows(q, kind, rangeStart, rangeEnd),
      }))
      .filter((lane) => lane.windows.length > 0);
    rows.push({
      id: conn.id,
      provider: conn.provider,
      label: conn.name || conn.email || conn.providerName || conn.provider,
      providerName: conn.providerName || conn.provider,
      isActive: conn.isActive !== false,
      chips,
      lanes,
    });
  }
  return rows;
}
