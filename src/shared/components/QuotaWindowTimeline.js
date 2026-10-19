"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { meterFill, meterSolid } from "@/shared/components/QuotaMeter";
import { translate, getCurrentLocale } from "@/i18n/runtime";
import { translateQuotaName } from "@/shared/utils/quotaName";
import { splitFamilyWindow } from "@/shared/utils/quotaRows";
import { buildTimelineRows, viewRange, VIEWS, DAY_MS } from "@/shared/utils/quotaWindows";
import { cn } from "@/shared/utils/cn";

/**
 * 配额窗口 — every account's cycle windows on one time axis (endpoint page).
 *
 *   账号                 | 一 09/28 | 二 09/29 | 三 09/30 | …
 *   ● Antigravity        |  [▓▓▓▓▓▓53% · 10/01 10:40 重置]┊ 10/01 10:40 ┊ …
 *     Gemini · 每周 53%   |            ↑ now
 *
 * The current window is a meter (fill = what is left, the same health gradient
 * as every quota bar); the windows after it are dashed outlines starting at the
 * next reset. Two views: 按周 (two weeks — daily/weekly/monthly windows) and
 * 5 小时 (the 24h around now — the 5h windows).
 *
 * Data is /api/usage/quotas (server-cached per connection), painted first from
 * the browser's copy so the page never waits on upstream quota APIs.
 *
 * Lives as the "配额窗口" view of the quota tracker, which passes its own
 * provider / account-status filters and bumps `refreshKey` from its refresh
 * button (that refetch uses ?force=1).
 */
const CACHE_KEY = "quotaWindowsCache";
const LEFT_COL = "w-[220px] shrink-0";

function readCache() {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(connections) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ connections, at: Date.now() }));
  } catch {
    // best effort
  }
}

const pad = (n) => String(n).padStart(2, "0");
const mmdd = (t) => {
  const d = new Date(t);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
};
const hhmm = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function weekday(t) {
  try {
    return new Date(t).toLocaleDateString(getCurrentLocale() || undefined, { weekday: "short" });
  } catch {
    return "";
  }
}

/** Short lane label: the family ("Gemini 模型") when a row carries one, else the row name. */
function laneLabel(name) {
  const split = splitFamilyWindow(name);
  return split ? translate(split.family) : translateQuotaName(name);
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="flex h-8 items-center rounded-lg border border-black/10 bg-surface p-0.5 dark:border-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "h-full rounded-md px-2.5 text-xs transition-colors",
            value === o.value ? "bg-primary/10 font-medium text-primary" : "text-text-muted hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

Segmented.propTypes = {
  value: PropTypes.string.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, label: PropTypes.node })).isRequired,
  onChange: PropTypes.func.isRequired,
};

/** One window on the axis, positioned in % of [start, end). */
function WindowBar({ win, lane, range, showLabel, view }) {
  // Same-day axis: the date is noise, the time is the information.
  const at = (t) => (view === "hours" ? hhmm(t) : `${mmdd(t)} ${hhmm(t)}`);
  const span = range.end - range.start;
  const left = Math.max(0, (win.start - range.start) / span) * 100;
  const right = Math.min(1, (win.end - range.start) / span) * 100;
  const width = Math.max(0.5, right - left);
  const clippedLeft = win.start < range.start;
  const clippedRight = win.end > range.end;
  const radius = cn(!clippedLeft && "rounded-l-[4px]", !clippedRight && "rounded-r-[4px]");
  const style = { left: `${left}%`, width: `${width}%` };

  if (!win.current) {
    return (
      <div
        className={cn("absolute inset-y-0 overflow-hidden border border-dashed border-black/15 dark:border-white/15", radius)}
        style={style}
        title={`${laneLabel(lane.name)} · ${mmdd(win.start)} ${hhmm(win.start)} – ${mmdd(win.end)} ${hhmm(win.end)}`}
      >
        <span className="absolute inset-y-0 left-1.5 right-1.5 flex items-center truncate text-[10px] tabular-nums text-text-muted/70">
          {at(win.start)}
        </span>
      </div>
    );
  }

  const pct = Math.round(lane.pct);
  const when = translate("resets {date}").replace("{date}", at(win.end));
  const label = `${showLabel ? `${laneLabel(lane.name)} · ` : ""}${pct}% · ${when}`;
  return (
    <div
      className={cn("absolute inset-y-0 overflow-hidden bg-black/[0.06] dark:bg-white/[0.08]", radius)}
      style={style}
      title={label}
    >
      <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, opacity: 0.85, ...meterFill(pct) }} />
      <span className="absolute inset-y-0 left-1.5 right-1.5 flex items-center truncate text-[10px] font-medium tabular-nums text-text">
        {label}
      </span>
    </div>
  );
}

WindowBar.propTypes = {
  win: PropTypes.object.isRequired,
  lane: PropTypes.object.isRequired,
  range: PropTypes.object.isRequired,
  showLabel: PropTypes.bool,
  view: PropTypes.string,
};

export default function QuotaWindowTimeline({
  providerFilter = "all",
  accountFilter = "all",
  refreshKey = 0,
  showTrackerLink = true,
}) {
  const [connections, setConnections] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState("week");
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(null);

  // Paint from the browser cache, then revalidate. The clock starts in an
  // effect too, so the server-rendered markup never carries a timestamp.
  useEffect(() => {
    let cancelled = false;
    // First run paints from cache; a bumped refreshKey is an explicit refresh.
    const cached = refreshKey === 0 ? readCache() : null;
    const load = async () => {
      if (cached?.connections) setConnections(cached.connections);
      setNow(Date.now());
      setRefreshing(true);
      try {
        const res = await fetch(`/api/usage/quotas${refreshKey > 0 ? "?force=1" : ""}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setConnections(body.connections || []);
        setError(null);
        writeCache(body.connections || []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load quotas");
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };
    load();
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [refreshKey]);

  // The tracker's own filters apply here too.
  const filtered = useMemo(
    () =>
      (connections || []).filter((c) => {
        if (providerFilter !== "all" && c.provider !== providerFilter) return false;
        if (accountFilter === "active" && c.isActive === false) return false;
        if (accountFilter === "inactive" && c.isActive !== false) return false;
        return true;
      }),
    [connections, providerFilter, accountFilter],
  );

  const range = useMemo(() => (now ? viewRange(view, now, offset) : null), [view, now, offset]);
  const rows = useMemo(
    () => (range && connections ? buildTimelineRows(filtered, { view, rangeStart: range.start, rangeEnd: range.end }) : []),
    [connections, filtered, view, range],
  );

  const ticks = useMemo(() => {
    if (!range) return [];
    const step = VIEWS[view].tickMs;
    const out = [];
    for (let t = range.start; t < range.end; t += step) out.push(t);
    return out;
  }, [range, view]);

  const nowPct = range && now >= range.start && now < range.end ? ((now - range.start) / (range.end - range.start)) * 100 : null;
  const todayStart = now ? new Date(new Date(now).setHours(0, 0, 0, 0)).getTime() : null;

  const subtitle = range
    ? view === "hours"
      ? `${mmdd(range.start)} ${hhmm(range.start)} – ${mmdd(range.end)} ${hhmm(range.end)}`
      : `${mmdd(range.start)} – ${mmdd(range.end - DAY_MS)} · ${translate("two weeks")}`
    : "";

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <span className="material-symbols-outlined text-[20px] text-primary">date_range</span>
            {translate("Quota windows")}
            {refreshing && (
              <span className="material-symbols-outlined animate-spin text-[14px] text-text-muted" aria-label={translate("Refreshing")}>
                progress_activity
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-text-muted tabular-nums">
            {subtitle}
            {offset === 0 && subtitle ? ` · ${translate("current")}` : ""}
          </p>
        </div>
        <div className="flex h-8 items-center rounded-lg border border-black/10 bg-surface dark:border-white/10">
          <button type="button" onClick={() => setOffset((o) => o - 1)} className="flex h-full w-8 items-center justify-center text-text-muted hover:text-text" aria-label={translate("Previous")}>
            <span className="material-symbols-outlined text-[16px]">chevron_left</span>
          </button>
          <button
            type="button"
            onClick={() => setOffset(0)}
            disabled={offset === 0}
            className="h-full border-x border-black/10 px-2.5 text-xs text-text disabled:text-text-muted dark:border-white/10"
          >
            {translate(view === "hours" ? "current" : "Today")}
          </button>
          <button type="button" onClick={() => setOffset((o) => o + 1)} className="flex h-full w-8 items-center justify-center text-text-muted hover:text-text" aria-label={translate("Next")}>
            <span className="material-symbols-outlined text-[16px]">chevron_right</span>
          </button>
        </div>
        <Segmented
          value={view}
          onChange={(v) => {
            setView(v);
            setOffset(0);
          }}
          options={[
            { value: "week", label: translate("By week") },
            { value: "hours", label: translate("5 hours") },
          ]}
        />
        {showTrackerLink && (
        <Link href="/dashboard/quota" className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-text-muted hover:bg-black/[0.04] hover:text-text dark:hover:bg-white/[0.06]">
          {translate("Quota Tracker")}
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </Link>
        )}
      </div>

      {connections === null ? (
        <div className="py-10 text-center text-xs text-text-muted">
          <span className="material-symbols-outlined animate-spin text-[22px]">progress_activity</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center text-xs text-text-muted">
          {error ? `${translate("Failed to load quotas")} · ${error}` : translate("No accounts with recurring quota windows")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10">
          <div className="min-w-[760px]">
            {/* Axis */}
            <div className="flex border-b border-black/10 bg-black/[0.015] dark:border-white/10 dark:bg-white/[0.02]">
              <div className={cn(LEFT_COL, "flex items-end px-3 pb-1.5 text-[11px] text-text-muted")}>{translate("Account")}</div>
              <div className="relative flex flex-1">
                {ticks.map((t, i) => {
                  const isToday = view === "week" && t === todayStart;
                  const showHourLabel = view !== "hours" || new Date(t).getHours() % 2 === 0;
                  return (
                    <div
                      key={t}
                      className={cn(
                        "flex-1 border-l border-black/5 px-0.5 py-1.5 text-center dark:border-white/5",
                        i === 0 && "border-l-0",
                        isToday && "bg-primary/[0.06]",
                      )}
                    >
                      {view === "hours" ? (
                        <div className="text-[10px] tabular-nums text-text-muted">{showHourLabel ? `${pad(new Date(t).getHours())}` : ""}</div>
                      ) : (
                        <>
                          <div className={cn("text-[10px]", isToday ? "text-primary" : "text-text-muted")}>{weekday(t)}</div>
                          <div className={cn("text-[11px] font-medium tabular-nums", isToday ? "text-primary" : "text-text")}>{mmdd(t)}</div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rows */}
            {rows.map((row) => (
              <div key={row.id} className={cn("flex border-b border-black/5 last:border-b-0 dark:border-white/5", !row.isActive && "opacity-55")}>
                <div className={cn(LEFT_COL, "space-y-1 px-3 py-2.5")}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <ProviderIcon
                      src={`/providers/${row.provider}.png`}
                      alt={row.provider}
                      size={16}
                      className="shrink-0 rounded object-contain"
                      fallbackText={String(row.provider || "?").slice(0, 2).toUpperCase()}
                    />
                    <span className="truncate text-xs font-medium text-text" title={`${row.providerName} · ${row.label}`}>
                      {row.label}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {row.chips.map((chip) => (
                      <span
                        key={chip.name}
                        className="inline-flex max-w-full items-center gap-1 rounded-[3px] bg-black/[0.04] px-1.5 py-px text-[10px] text-text-muted dark:bg-white/[0.06]"
                        title={translateQuotaName(chip.name)}
                      >
                        <span className="size-1.5 shrink-0 rounded-full" style={{ background: meterSolid(chip.pct) }} />
                        <span className="truncate">{translateQuotaName(chip.name)}</span>
                        <b className="font-semibold tabular-nums text-text">{chip.pct}%</b>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="relative flex-1 py-2.5">
                  {/* day/hour grid */}
                  <div className="pointer-events-none absolute inset-0 flex">
                    {ticks.map((t, i) => (
                      <div
                        key={t}
                        className={cn(
                          "flex-1 border-l border-black/[0.04] dark:border-white/[0.05]",
                          i === 0 && "border-l-0",
                          view === "week" && t === todayStart && "bg-primary/[0.04]",
                        )}
                      />
                    ))}
                  </div>
                  {nowPct !== null && (
                    <div className="pointer-events-none absolute inset-y-0 w-px bg-primary/60" style={{ left: `${nowPct}%` }} />
                  )}
                  <div className="relative space-y-1">
                    {row.lanes.length === 0 ? (
                      <div className="flex h-[18px] items-center px-2 text-[10px] text-text-muted/70">
                        {translate(view === "hours" ? "No 5-hour window" : "No daily / weekly / monthly window")}
                      </div>
                    ) : (
                      row.lanes.map((lane) => (
                        <div key={lane.name} className="relative h-[18px]">
                          {lane.windows.map((win) => (
                            <WindowBar key={`${lane.name}-${win.start}`} win={win} lane={lane} range={range} view={view} showLabel={row.lanes.length > 1} />
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

QuotaWindowTimeline.propTypes = {
  providerFilter: PropTypes.string,
  accountFilter: PropTypes.string,
  refreshKey: PropTypes.number,
  showTrackerLink: PropTypes.bool,
};
