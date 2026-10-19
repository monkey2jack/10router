"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import { fmtCost } from "@/shared/utils/currency";
import { fmtTokens } from "@/shared/utils/compactNumber";
import { getCurrentLocale } from "@/i18n/runtime";

export default function OverviewCards({ stats }) {
  // The 单位缩写 toggle previously did not reach this card row (it formatted
  // with a bare Intl.NumberFormat, always full thousand-separated). Route every
  // counter through fmtTokens so the Overview obeys the same switch as the
  // Details tab, and read the locale so 亿/万 vs B/M/K matches the rest of the
  // page. Est. Cost keeps fmtCost — currency is not a unit abbreviation.
  const locale = getCurrentLocale();
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-4">
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Total Requests</span>
        <span className="w-full truncate text-lg font-bold xl:text-xl" title={fmtTokens(stats.totalRequests, locale)}>{fmtTokens(stats.totalRequests, locale)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Total Input Tokens</span>
        <span className="w-full truncate text-lg font-bold text-primary xl:text-xl" title={fmtTokens(stats.totalPromptTokens, locale)}>{fmtTokens(stats.totalPromptTokens, locale)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Cached Tokens</span>
        <span className="w-full truncate text-lg font-bold text-info xl:text-xl" title={fmtTokens(stats.totalCachedTokens, locale)}>{fmtTokens(stats.totalCachedTokens, locale)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Output Tokens</span>
        <span className="w-full truncate text-lg font-bold text-success xl:text-xl" title={fmtTokens(stats.totalCompletionTokens, locale)}>{fmtTokens(stats.totalCompletionTokens, locale)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Est. Cost</span>
        <span className="w-full truncate text-lg font-bold text-warning xl:text-xl" title={`~${fmtCost(stats.totalCost)}`}>~{fmtCost(stats.totalCost)}</span>
        <span className="text-[10px] text-text-muted">Estimated, not actual billing</span>
      </Card>
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
