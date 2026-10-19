// Drex — Nace's System One decision model (drex.nace.ai). Wire-compatible with
// TypeSafe's Jev per their own docs ("Migrate from TypeSafe"), so it rides the
// /v1/systemone decision lane with zero chat translation: state + typed
// questions (noul / choice / score) in, calibrated probability distributions
// out. Bearer auth with a nace_sk_ key, injected by the systemoneCore handler.
// Catalog verified live 2026-10-01 via GET /v1/models with a real key. The API
// has exactly two endpoints (evaluate + list models) and no quota API, so no
// usage card is wired (features.usage stays unset).
export default {
  id: "drex",
  alias: "drex",
  category: "apikey",
  display: {
    name: "Drex",
    icon: "psychology",
    color: "#131313",
    textIcon: "DX",
    website: "https://drex.nace.ai",
    notice: {
      apiKeyUrl: "https://drex.nace.ai/invite/tnzgt5vr",
    },
  },
  models: [
    { id: "drex-v1.0", name: "Drex v1.0", kind: "systemone" },
    { id: "drex-v1.1", name: "Drex v1.1", kind: "systemone" },
    // v1.5: states up to 131,072 tokens (models page, 2026-09-28 release).
    { id: "drex-v1.5", name: "Drex v1.5", kind: "systemone" },
    // Alias row that tracks the current minor (v1.5 today), upstream-pinned.
    { id: "drex-latest", name: "Drex Latest", kind: "systemone" },
  ],
  serviceKinds: ["systemone"],
  systemoneConfig: {
    baseUrl: "https://drex.nace.ai/v1/systemone",
  },
};
