// SiliconFlow 中国区 (api.siliconflow.cn) — 国内直连节点，LLM/Embedding/Rerank/
// 生图模型齐全（issue #19-3）。独立成家而非与国际区 (siliconflow) 合并：密钥、
// 端点、网络面完全不同。目录以「Import from /models」动态拉取为主
// （MODELS_CONFIGS 的 siliconflow-cn 条目），下方仅为基线；倍率按官方价目
// ¥→$（÷7.15）录入 pricing.js 的 PROVIDER_PRICING。
export default {
  id: "siliconflow-cn",
  priority: 115,
  alias: "siliconflow-cn",
  aliases: ["sfcn"],
  uiAlias: "sfcn",
  display: {
    name: "SiliconFlow CN",
    icon: "bolt",
    color: "#1FA34A",
    textIcon: "SF",
    website: "https://siliconflow.cn",
    notice: {
      apiKeyUrl: "https://cloud.siliconflow.cn/i/OzcMUfeM",
    },
  },
  category: "apikey",
  authType: "apikey",
  // 媒体面(issue #19-3 补全): 图片/视频/嵌入与 chat 同一 Bearer key, OpenAI 风格
  // 端点; 模型经「Import from /models」拉全, 媒体模型按 kind 标记归入对应页面。
  serviceKinds: ["llm", "image", "video", "embedding", "rerank"],
  imageConfig: { baseUrl: "https://api.siliconflow.cn/v1/images/generations" },
  videoConfig: { baseUrl: "https://api.siliconflow.cn/v1/videos/generations" },
  embeddingConfig: { baseUrl: "https://api.siliconflow.cn/v1/embeddings" },
  // BAAI 重排序线(issue #29): /v1/rerank 与 Cohere/Jina 同一方言
  // (query + documents → results[].index/relevance_score)。目录以 Import
  // from /models 拉全(bge-reranker-*), 基线只放当前主打两款。
  rerankConfig: { baseUrl: "https://api.siliconflow.cn/v1/rerank" },
  transport: {
    baseUrl: "https://api.siliconflow.cn/v1/chat/completions",
    validateUrl: "https://api.siliconflow.cn/v1/models",
  },
  models: [
    { id: "deepseek-ai/DeepSeek-V3.2", name: "DeepSeek V3.2" },
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" },
    { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6" },
    // 媒体基线(官方价目 2026-09-16): Kolors 免费, Z-Image-Turbo ¥0.10/张,
    // Qwen-Image ¥0.30/张, Wan2.2 文生/图生视频 ¥2/条。长尾(ERNIE-Image 等)
    // 走导入目录。
    { id: "Kwai-Kolors/Kolors", name: "Kolors", params: ["size"], kind: "image" },
    { id: "zai-org/Z-Image-Turbo", name: "Z-Image Turbo", params: ["size"], kind: "image" },
    { id: "Qwen/Qwen-Image", name: "Qwen Image", params: ["size"], kind: "image" },
    { id: "Wan-AI/Wan2.2-T2V-A14B", name: "Wan2.2 T2V", params: ["size"], kind: "video" },
    { id: "Wan-AI/Wan2.2-I2V-A14B", name: "Wan2.2 I2V", params: ["size"], kind: "video" },
    // 重排序基线(官方价目 2026-10): Pro ¥0.8/1M tok, 其余免费
    { id: "BAAI/bge-reranker-v2-m3", name: "BGE Reranker v2 M3", kind: "rerank" },
    { id: "BAAI/bge-reranker-v2-gemma", name: "BGE Reranker v2 Gemma", kind: "rerank" },
  ],
  features: {
    usage: true,
    usageApikey: true,
  },
};
