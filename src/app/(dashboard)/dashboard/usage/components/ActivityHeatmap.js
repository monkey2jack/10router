"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import SegmentedControl from "@/shared/components/SegmentedControl";
import { cn } from "@/shared/utils/cn";
import { fmtTokens } from "@/shared/utils/compactNumber";
import { translate, getCurrentLocale } from "@/i18n/runtime";

const LEVEL_CLASSES = [
  "bg-black/[0.07] dark:bg-white/[0.08]",
  "bg-primary/25",
  "bg-primary/50",
  "bg-primary/75",
  "bg-primary",
];

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const GAP = 4;
const LABEL_COL = 32;
const MONTH_ROW_H = 12;
// Row gaps: 5 normal + 1 widened (Fri→Sat, +20%).
const TOTAL_ROW_GAP = 5 * GAP + GAP * 1.2;

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function levelOf(requests, maxRequests) {
  if (requests === 0 || maxRequests === 0) return 0;
  return Math.min(4, Math.ceil((requests / maxRequests) * 4));
}

function TipCell({ dateLine, statsLine, style, className, onEnter, onLeave, showTip = true }) {
  return (
    <div
      className="relative inline-flex shrink-0 group/tt"
      style={style}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className={className} style={{ width: "100%", height: "100%" }} />
      {showTip && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-max -translate-x-1/2 rounded border border-black/10 bg-white px-2 py-1 text-[11px] leading-snug text-text-main opacity-0 shadow-lg transition-opacity duration-150 group-hover/tt:opacity-100 dark:border-white/10 dark:bg-gray-700 dark:text-white">
          <div className="font-medium">{dateLine}</div>
          <div className="text-text-muted dark:text-white/80">{statsLine}</div>
        </div>
      )}
    </div>
  );
}

TipCell.propTypes = {
  dateLine: PropTypes.string.isRequired,
  statsLine: PropTypes.string.isRequired,
  style: PropTypes.object,
  className: PropTypes.string,
  onEnter: PropTypes.func,
  onLeave: PropTypes.func,
  showTip: PropTypes.bool,
};

function buildWeeks(daily, days) {
  const byDate = {};
  let maxRequests = 0;
  for (const d of daily || []) {
    byDate[d.date] = d;
    if (d.requests > maxRequests) maxRequests = d.requests;
  }

  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() - (cursor.getDay() + 6) % 7);

  const weeks = [];
  while (cursor <= end) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(cursor);
      const key = dateKey(date);
      const inRange = date >= start && date <= end;
      const entry = byDate[key];
      const requests = entry?.requests || 0;
      week.push({
        key,
        date: new Date(date),
        inRange,
        requests,
        tokens: entry?.tokens || 0,
        cost: entry?.cost || 0,
        level: !inRange ? 0 : levelOf(requests, maxRequests),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function weekStat(week) {
  let requests = 0;
  let tokens = 0;
  for (const d of week) {
    if (!d.inRange) continue;
    requests += d.requests;
    tokens += d.tokens;
  }
  return { requests, tokens };
}

export default function ActivityHeatmap({ daily, days = 365, currentStreak }) {
  const [view, setView] = useState("day");
  const [hoverCol, setHoverCol] = useState(null);
  const locale = getCurrentLocale();
  const weeks = buildWeeks(daily, days);
  const monthFmt = (date) => date.toLocaleDateString(locale === "en" ? "en-US" : locale, { month: "short" });
  const fullDateFmt = (date) => date.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });

  // Fixed-height grid: cell size derives from height (never stretches with
  // width); wider containers simply show more trailing weeks. The week view
  // keeps the exact same grid — hovering a column shows that week's aggregate.
  const gridRef = useRef(null);
  const [gridSize, setGridSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!gridRef.current) return undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setGridSize({ w: r.width, h: r.height });
    });
    ro.observe(gridRef.current);
    return () => ro.disconnect();
  }, []);

  const cell = gridSize.h > 0 ? Math.max(6, (gridSize.h - TOTAL_ROW_GAP) / 7) : 0;
  const visibleWeeks = cell > 0
    ? Math.min(weeks.length, Math.max(4, Math.floor((gridSize.w - LABEL_COL - GAP + GAP) / (cell + GAP))))
    : 0;
  const shownWeeks = visibleWeeks > 0 ? weeks.slice(-visibleWeeks) : [];

  // Week mode: one color per column, from the week's 7-day average.
  const shownWeekStats = shownWeeks.map(weekStat);
  const maxWeekAvg = shownWeekStats.reduce((m, s) => Math.max(m, s.requests / 7), 0);

  // Totals follow what is actually visible.
  let totalRequests = 0;
  let totalTokens = 0;
  let activeDays = 0;
  for (const week of shownWeeks) {
    for (const d of week) {
      if (!d.inRange) continue;
      totalRequests += d.requests;
      totalTokens += d.tokens;
      if (d.requests > 0) activeDays += 1;
    }
  }

  const streakText = currentStreak != null
    ? (locale.startsWith("zh-tw") || locale === "zh-HK"
        ? ` · 連續 ${currentStreak} 天`
        : locale.startsWith("zh")
        ? ` · 连续 ${currentStreak} 天`
        : ` · ${currentStreak}d streak`)
    : "";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[10px] text-text-muted">
          <span>{translate("Less")}</span>
          {LEVEL_CLASSES.map((cls, i) => (
            <span key={i} className={cn("w-3 h-3 shrink-0 rounded-sm", cls)} />
          ))}
          <span>{translate("More")}</span>
        </span>
        <SegmentedControl
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "day", label: translate("Day") },
            { value: "week", label: translate("Week") },
          ]}
        />
      </div>

      <div className="pb-1">
        <div className="flex" style={{ gap: GAP, paddingLeft: LABEL_COL + GAP, height: MONTH_ROW_H }}>
          {shownWeeks.map((week, wi) => (
            <div
              key={wi}
              style={{ width: cell }}
              className="shrink-0 overflow-visible whitespace-nowrap text-[9px] leading-none text-text-muted"
            >
              {wi > 0 && week[6].date.getMonth() !== shownWeeks[wi - 1][6].date.getMonth() ? monthFmt(week[6].date) : ""}
            </div>
          ))}
        </div>
        <div ref={gridRef} className="mt-1 h-[150px] sm:h-[170px]">
          {cell > 0 && WEEKDAY_LABELS.map((label, dow) => (
            <div
              key={label}
              className="flex"
              style={{ gap: GAP, marginTop: dow === 0 ? 0 : dow === 5 ? GAP * 1.2 : GAP }}
            >
              <div
                style={{ width: LABEL_COL }}
                className="flex shrink-0 items-center text-[9px] leading-none text-text-muted"
              >
                {dow % 2 === 0 ? translate(label) : ""}
              </div>
              {shownWeeks.map((week, wi) => {
                const day = week[dow];
                const isWeek = view === "week";
                const colHighlight = isWeek && hoverCol === wi;

                if (isWeek) {
                  // Week mode: hovering any cell highlights the column; the
                  // aggregate tooltip is always anchored at the column top
                  // (Monday position), no matter which cell is hovered.
                  const inRangeDays = week.filter((d) => d.inRange);
                  const ws = weekStat(week);
                  return (
                    <div
                      key={day.key}
                      className="relative inline-flex shrink-0"
                      style={{ width: cell, height: cell }}
                      onMouseEnter={() => day.inRange && setHoverCol(wi)}
                      onMouseLeave={() => day.inRange && setHoverCol(null)}
                    >
                      <div
                        style={{ width: "100%", height: "100%" }}
                        className={cn(
                          "rounded-sm transition-transform",
                          day.inRange ? LEVEL_CLASSES[levelOf(ws.requests / 7, maxWeekAvg)] : "bg-transparent",
                          colHighlight && day.inRange && "scale-110 ring-1 ring-text-main/50"
                        )}
                      />
                      {dow === 0 && inRangeDays.length > 0 && (
                        <div className={cn(
                          "pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-max -translate-x-1/2 rounded border border-black/10 bg-white px-2 py-1 text-[11px] leading-snug text-text-main shadow-lg transition-opacity duration-150 dark:border-white/10 dark:bg-gray-700 dark:text-white",
                          colHighlight ? "opacity-100" : "opacity-0"
                        )}>
                          <div className="font-medium">{`${fullDateFmt(inRangeDays[inRangeDays.length - 1].date)} ${translate("This Week")}`}</div>
                          <div className="text-text-muted dark:text-white/80">{`${fmtTokens(ws.tokens, locale, true)} tokens · ${ws.requests} ${translate("requests")}`}</div>
                        </div>
                      )}
                    </div>
                  );
                }

                if (!day.inRange) {
                  return <div key={day.key} style={{ width: cell, height: cell }} className="shrink-0 bg-transparent" />;
                }
                return (
                  <TipCell
                    key={day.key}
                    style={{ width: cell, height: cell }}
                    dateLine={fullDateFmt(day.date)}
                    statsLine={`${fmtTokens(day.tokens, locale, true)} tokens · ${day.requests} ${translate("requests")}`}
                    className={cn(
                      "rounded-sm transition-transform hover:scale-110 hover:ring-1 hover:ring-text-main/40",
                      LEVEL_CLASSES[day.level]
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="text-[10px] text-text-muted">
        {`${totalRequests.toLocaleString()} ${translate("requests")} · ${fmtTokens(totalTokens, locale, true)} ${translate("tokens")} · ${activeDays} ${translate("active days")}${streakText}`}
      </div>
    </div>
  );
}

ActivityHeatmap.propTypes = {
  daily: PropTypes.arrayOf(
    PropTypes.shape({
      date: PropTypes.string.isRequired,
      requests: PropTypes.number,
      tokens: PropTypes.number,
      cost: PropTypes.number,
    })
  ),
  days: PropTypes.number,
  currentStreak: PropTypes.number,
};
