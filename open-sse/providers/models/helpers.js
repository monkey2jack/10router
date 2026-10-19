// Codex auto-generates a "-review" variant for each llm model (review quota family)
export const CODEX_REVIEW_SUFFIX = "-review";

export function withCodexReviewModels(models) {
  return models.flatMap((model) => {
    if ((model.kind || model.type || "llm") !== "llm" || model.id.endsWith(CODEX_REVIEW_SUFFIX)) {
      return [model];
    }
    return [
      model,
      {
        ...model,
        id: `${model.id}${CODEX_REVIEW_SUFFIX}`,
        name: `${model.name} Review`,
        upstreamModelId: model.upstreamModelId || model.id,
        quotaFamily: "review"
      }
    ];
  });
}

// Muse Spark (opencode Zen) models are served via the Responses API —
// detect them by name pattern so thinking-suffixed ids ("model(high)")
// and vendor-prefixed ids still match. See executors/opencode.js.
export function isMuseSparkModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return /^muse[-_]?spark(?:$|[-_:.\s])/i.test(base);
}

// 裸 id（"deepseek-v4-pro(max)"）与供应商前缀 id 都要命中；末尾 "(level)"
// 是 thinking 档位覆盖标记，先剥掉再按 ^deepseek- 锚定匹配，避免误伤
// "my-deepseek-x" 这类仅包含关键字的其他模型族。供 Claude /messages 翻译层
// 判断「opencode-go 托管的 DeepSeek」门控。
export function isDeepSeekModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return /^deepseek-/i.test(base);
}
