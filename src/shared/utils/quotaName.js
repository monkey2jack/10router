/**
 * Quota row name translation — shared so both the usage-page table and the
 * quota-block summary can render localized pack names ("Bonus Pack 18" →
 * "赠送包 18", "Balance (CNY)" → "余额 (CNY)").
 */
import { translate } from "@/i18n/runtime";

export function translateQuotaName(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  const direct = translate(trimmed);
  if (direct !== trimmed) return direct;
  // Antigravity "<family> · <window>": translate each half on its own.
  const mFamily = /^(.+?)\s+·\s+(.+)$/.exec(trimmed);
  if (mFamily) return `${translate(mFamily[1])} · ${translate(mFamily[2])}`;
  const mBonus = /^Bonus Pack (\d+)$/.exec(trimmed);
  if (mBonus) return `${translate("Bonus Pack")} ${mBonus[1]}`;
  const mWeekly = /^weekly\s+(.+)\s+\(7d\)$/i.exec(trimmed);
  if (mWeekly) return `${translate("Weekly")} ${mWeekly[1]} (7d)`;
  const mBalance = /^Balance(?:\s*\((.+)\))?$/i.exec(trimmed);
  if (mBalance) return mBalance[1] ? `${translate("Balance")} (${mBalance[1]})` : translate("Balance");
  const mVoucher = /^Voucher(?:\s*\((.+)\))?$/i.exec(trimmed);
  if (mVoucher) return mVoucher[1] ? `${translate("Voucher")} (${mVoucher[1]})` : translate("Voucher");
  const mCash = /^Cash(?:\s*\((.+)\))?$/i.exec(trimmed);
  if (mCash) return mCash[1] ? `${translate("Cash")} (${mCash[1]})` : translate("Cash");
  return trimmed;
}
