// 大数字缩写显示开关（localStorage: compactUnits，默认开启）。
// 开启时：中文界面 ≥1e8 → X.X亿、≥1e4 → X.X万；其他语言 ≥1e9 → B、≥1e6 → M、≥1e3 → K。
// 关闭时始终显示完整千分位数字。设置入口：设置页语言卡「单位缩写」。

export function isCompactUnitsEnabled() {
  if (typeof localStorage === "undefined") return true;
  const v = localStorage.getItem("compactUnits");
  return v === null ? true : v !== "0";
}

export function fmtTokens(n, locale = "en", force = false) {
  const v = n || 0;
  if (!force && !isCompactUnitsEnabled()) return v.toLocaleString();
  const zh = String(locale).startsWith("zh");
  if (zh) {
    if (v >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
    if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
    return v.toLocaleString();
  }
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
}
