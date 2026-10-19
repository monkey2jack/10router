import { describe, expect, it } from "vitest";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";
import { isStoredValueRow, needsPerPackDetails } from "../../src/shared/utils/quotaRows.js";

// minimax-code 的 Credits 行是算力币**余额**（getMiniMaxCodeUsage 打了
// isCreditBalance: true）。parseQuotaData 的 default 分支曾把旗标丢掉，
// isStoredValueRow 只认行名正则（balance|voucher|cash|余额|代金券|现金），
// "Credits" 退化成普通 X/Y 进度行——卡面印出「999.96 / 999.96」，
// 同一数值印两遍（储值行口径：只出单值 + 小字单位）。
const PAYLOAD = {
  quotas: {
    Credits: { used: 0, total: 999.96, remaining: 999.96, isCreditBalance: true, currency: "credits" },
  },
};

describe("parseQuotaData — minimax-code Credits is a stored-value balance", () => {
  it("keeps isCreditBalance through the generic fallback", () => {
    const rows = parseQuotaData("minimax-code", PAYLOAD);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Credits", used: 0, total: 999.96, isCreditBalance: true });
  });

  it("classifies the row as stored-value so the card prints one value, not X / Y", () => {
    const [row] = parseQuotaData("minimax-code", PAYLOAD);
    expect(isStoredValueRow(row)).toBe(true);
    // 单行储值余额：无逐包明细可折叠，卡面就一行大数字
    expect(needsPerPackDetails([row])).toBe(false);
  });

  it("does not invent the flag for rows that lack it", () => {
    const rows = parseQuotaData("minimax-code", { quotas: { Windows: { used: 1, total: 2 } } });
    expect(rows[0].isCreditBalance).toBeUndefined();
    expect(isStoredValueRow(rows[0])).toBe(false);
  });
});
