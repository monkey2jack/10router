/**
 * Overlay server-published Qoder pricing onto the static registry models.
 *
 * The provider page's official model list is the static catalog (ids are the
 * raw Qoder keys: "qfmodel", "qmodel_38max", …), while /api/providers/[id]/models
 * returns the LIVE catalog with ids prefixed "<provider>/<key>". The live
 * entries carry the promo-aware pricing the static file can't know about
 * (price_factor currently 0 for a free window, the off-peak promotion object
 * with its 22:00–08:00 window). This joins them by bare key and copies only
 * the pricing fields — names/capabilities stay the curated static ones.
 *
 * Pure + JSX-free for unit tests.
 */
export function mergeQoderLivePricing(staticModels, liveModels) {
  if (!Array.isArray(staticModels)) return staticModels;
  if (!Array.isArray(liveModels) || liveModels.length === 0) return staticModels;
  const byKey = new Map(liveModels.map((m) => [String(m.id).split("/").pop(), m]));
  return staticModels.map((sm) => {
    const live = byKey.get(sm.id);
    if (!live) return sm;
    return {
      ...sm,
      rateMultiplier: typeof live.rateMultiplier === "number" ? live.rateMultiplier : sm.rateMultiplier,
      promotion: live.promotion ?? sm.promotion ?? null,
    };
  });
}
