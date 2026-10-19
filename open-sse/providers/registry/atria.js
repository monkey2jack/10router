// Atria Dawn (AtomInnoLab) — OpenAI-compatible endpoint, currently a research
// preview offering a single text model. Docs pin the model field to one
// case-sensitive id. Text-only for now: the service ships a hook that blocks
// image/PDF input, so no vision is claimed.
export default {
  id: "atria",
  alias: "atria",
  aliases: ["atria-asi"],
  uiAlias: "atria",
  display: {
    name: "Atria Dawn",
    icon: "flare",
    color: "#C2410C",
    textIcon: "AD",
    website: "https://atria-asi.ai",
    notice: {
      apiKeyUrl: "https://api.atria-asi.ai/console",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.atria-asi.ai/v1/chat/completions",
    validateUrl: "https://api.atria-asi.ai/v1/models",
  },
  models: [
    { id: "Atria-Dawn-Preview", name: "Atria Dawn Preview" },
  ],
  passthroughModels: true,
};
