const api = require("../api/client");
const { t } = require("../i18n");
const { prompt, confirm, pause } = require("../utils/input");
const { clearScreen, showStatus, showHeader } = require("../utils/display");
const { formatDate, getRelativeTime } = require("../utils/format");
const { showMenuWithBack } = require("../utils/menuHelper");
const { copyToClipboard } = require("../utils/clipboard");

// ANSI colors for styling
const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m"
};

// Provider models - static config (synced from open-sse/config/providerModels.js)
const PROVIDER_MODELS = {
  cc: [
    { id: "claude-opus-4-5-20251101" },
    { id: "claude-sonnet-4-5-20250929" },
    { id: "claude-haiku-4-5-20251001" },
  ],
  cx: [
    { id: "gpt-5.2-codex" },
    { id: "gpt-5.2" },
    { id: "gpt-5.1-codex-max" },
    { id: "gpt-5.1-codex" },
    { id: "gpt-5.1-codex-mini" },
    { id: "gpt-5.1" },
    { id: "gpt-5-codex" },
    { id: "gpt-5-codex-mini" },
  ],
  gc: [
    { id: "gemini-3-flash-preview" },
    { id: "gemini-3-pro-preview" },
    { id: "gemini-2.5-pro" },
    { id: "gemini-2.5-flash" },
    { id: "gemini-2.5-flash-lite" },
  ],
  qw: [
    { id: "qwen3-coder-plus" },
    { id: "qwen3-coder-flash" },
    { id: "vision-model" },
  ],
  if: [
    { id: "qwen3-coder-plus" },
    { id: "kimi-k2" },
    { id: "kimi-k2-thinking" },
    { id: "deepseek-r1" },
    { id: "deepseek-v3.2-chat" },
    { id: "deepseek-v3.2-reasoner" },
    { id: "minimax-m2" },
    { id: "glm-4.7" },
  ],
  ag: [
    { id: "gemini-3.8-flash-high" },
    { id: "gemini-3.8-flash-medium" },
    { id: "gemini-3.8-flash-low" },
    { id: "gemini-3.7-flash-high" },
    { id: "gemini-3.7-flash-medium" },
    { id: "gemini-3.7-flash-low" },
    { id: "gemini-3.6-flash-high" },
    { id: "gemini-3.6-flash-medium" },
    { id: "gemini-3.6-flash-low" },
    { id: "gemini-3-flash-agent" },
    { id: "gemini-3.5-flash-low" },
    { id: "gemini-3.5-flash-extra-low" },
    { id: "gemini-pro-agent" },
    { id: "gemini-3.1-pro-low" },
    { id: "claude-sonnet-4-6" },
    { id: "claude-opus-4-6-thinking" },
    { id: "gpt-oss-120b-medium" },
    { id: "gemini-3-flash" },
  ],
  gh: [
    { id: "gpt-5" },
    { id: "gpt-5-mini" },
    { id: "gpt-5.1-codex" },
    { id: "gpt-5.1-codex-max" },
    { id: "gpt-4.1" },
    { id: "claude-4.5-sonnet" },
    { id: "claude-4.5-opus" },
    { id: "claude-4.5-haiku" },
    { id: "gemini-3-pro" },
    { id: "gemini-3-flash" },
    { id: "gemini-2.5-pro" },
    { id: "grok-code-fast-1" },
  ],
  kr: [
    { id: "claude-sonnet-5" },
    { id: "claude-sonnet-4.5" },
    { id: "claude-haiku-4.5" },
  ],
  openai: [
    { id: "gpt-4o" },
    { id: "gpt-4o-mini" },
    { id: "gpt-4-turbo" },
    { id: "o1" },
    { id: "o1-mini" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514" },
    { id: "claude-opus-4-20250514" },
    { id: "claude-3-5-sonnet-20241022" },
  ],
  gemini: [
    { id: "gemini-3.6-flash" },
    { id: "gemini-3.5-flash-lite" },
    { id: "gemini-3-pro-preview" },
    { id: "gemini-2.5-pro" },
    { id: "gemini-2.5-flash" },
    { id: "gemini-2.5-flash-lite" },
  ],
  openrouter: [
    { id: "auto" },
  ],
  glm: [
    { id: "glm-4.7" },
    { id: "glm-4.6v" },
  ],
  kimi: [
    { id: "kimi-latest" },
  ],
  minimax: [
    { id: "MiniMax-M2.1" },
  ],
};

// Provider definitions
const OAUTH_PROVIDERS = {
  claude: { id: "claude", alias: "cc", name: "Claude Code" },
  codex: { id: "codex", alias: "cx", name: "OpenAI Codex" },
  "gemini-cli": { id: "gemini-cli", alias: "gc", name: "Gemini CLI" },
  github: { id: "github", alias: "gh", name: "GitHub Copilot" },
  antigravity: { id: "antigravity", alias: "ag", name: "Antigravity" },
  iflow: { id: "iflow", alias: "if", name: "iFlow AI" },
  qwen: { id: "qwen", alias: "qw", name: "Qwen Code" },
  kiro: { id: "kiro", alias: "kr", name: "Kiro AI" },
  glm: { id: "glm", alias: "glm", name: "Zai GLM Coding" },
};

const APIKEY_PROVIDERS = {
  openrouter: { id: "openrouter", name: "OpenRouter" },
  glm: { id: "glm", name: "Zai GLM Coding" },
  minimax: { id: "minimax", name: "Minimax Coding" },
  kimi: { id: "kimi", name: "Kimi" },
  openai: { id: "openai", name: "OpenAI" },
  anthropic: { id: "anthropic", name: "Anthropic" },
  gemini: { id: "gemini", name: "Gemini" },
};

const ALL_PROVIDERS = { ...OAUTH_PROVIDERS, ...APIKEY_PROVIDERS };

/**
 * Get auth type for provider
 * @param {string} providerId - Provider ID
 * @returns {string} "oauth" or "apikey"
 */
function getAuthType(providerId) {
  return OAUTH_PROVIDERS[providerId] ? "oauth" : "apikey";
}

/**
 * Count connections by provider
 * @param {Array} connections - Array of connection objects
 * @returns {Object} Map of providerId -> count
 */
function countConnectionsByProvider(connections) {
  const counts = {};
  connections.forEach(conn => {
    const providerId = conn.provider || conn.providerId;
    counts[providerId] = (counts[providerId] || 0) + 1;
  });
  return counts;
}

/**
 * Show main providers menu
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showProvidersMenu(breadcrumb = []) {
  // Build provider items list
  const providerItems = [];
  
  Object.values(OAUTH_PROVIDERS).forEach(provider => {
    providerItems.push({
      provider,
      authType: "oauth",
      label: (data) => {
        const count = data.counts[provider.id] || 0;
        return t("menus.providers.oauthCount", { name: provider.name, count });
      },
      action: async (data) => {
        await showProviderDetail(provider.id, "oauth", data.connections, [...breadcrumb, provider.name]);
        return true;
      }
    });
  });
  
  Object.values(APIKEY_PROVIDERS).forEach(provider => {
    providerItems.push({
      provider,
      authType: "apikey",
      label: (data) => {
        const count = data.counts[provider.id] || 0;
        return t("menus.providers.apiCount", { name: provider.name, count });
      },
      action: async (data) => {
        await showProviderDetail(provider.id, "apikey", data.connections, [...breadcrumb, provider.name]);
        return true;
      }
    });
  });

  // Custom provider nodes section
  providerItems.push({
    label: () => `${COLORS.dim}${t("menus.providers.customSeparator")}${COLORS.reset}`,
    action: async () => true, // separator, no-op
    isSeparator: true,
  });
  providerItems.push({
    label: (data) => {
      const count = data.nodeCount || 0;
      return t("menus.providers.customCount", { count });
    },
    action: async () => {
      await showCustomProvidersMenu([...breadcrumb, t("menus.providers.customProviders")]);
      return true;
    }
  });

  await showMenuWithBack({
    title: t("menus.providers.title"),
    breadcrumb,
    refresh: async () => {
      const [provRes, nodeRes] = await Promise.all([api.getProviders(), api.getProviderNodes()]);
      if (!provRes.success) {
        showStatus(t("menus.providers.fetchFailed", { error: provRes.error }), "error");
        await pause();
        return null;
      }
      const connections = provRes.data.connections || [];
      const nodes = nodeRes.success ? (nodeRes.data.nodes || nodeRes.data || []) : [];
      return {
        connections,
        counts: countConnectionsByProvider(connections),
        nodeCount: nodes.length,
      };
    },
    items: providerItems
  });
}

/**
 * Build provider header with alias and models
 * @param {string} providerId - Provider ID
 * @returns {string}
 */
function buildProviderHeader(providerId) {
  const provider = ALL_PROVIDERS[providerId];
  const alias = provider.alias || providerId;
  
  const lines = [];
  lines.push(t("menus.providers.aliasLabel", { value: `${COLORS.cyan}${alias}${COLORS.reset}` }));

  // Get models from static config
  const models = PROVIDER_MODELS[alias] || [];
  if (models.length > 0) {
    const modelList = models
      .slice(0, 5)
      .map(m => `${alias}/${m.id}`)
      .join(", ");
    const more = models.length > 5 ? t("menus.providers.moreModels", { count: models.length - 5 }) : "";
    lines.push(t("menus.providers.modelsLabel", { value: `${COLORS.dim}${modelList}${more}${COLORS.reset}` }));
  } else {
    lines.push(t("menus.providers.modelsLabel", { value: `${COLORS.dim}${t("menus.providers.noModels")}${COLORS.reset}` }));
  }
  
  return lines.join("\n");
}

/**
 * Show provider detail with connections and actions
 * @param {string} providerId - Provider ID
 * @param {string} authType - "oauth" or "apikey"
 * @param {Array} allConnections - All connections
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showProviderDetail(providerId, authType, allConnections, breadcrumb = []) {
  const provider = ALL_PROVIDERS[providerId];
  const { showListMenu } = require("../utils/menuHelper");
  
  await showListMenu({
    title: `🔌 ${provider.name} (${authType.toUpperCase()})`,
    breadcrumb,
    backLabel: t("menus.providers.back"),
    headerContent: buildProviderHeader(providerId),
    fetchItems: async () => {
      const response = await api.getProviders();
      if (response.success) {
        allConnections.length = 0;
        allConnections.push(...(response.data.connections || []));
      }
      const providerConns = allConnections.filter(conn => 
        (conn.provider || conn.providerId) === providerId
      );
      return { items: providerConns };
    },
    formatItem: (conn) => {
      const status = conn.testStatus === "active" ? "✓" : conn.testStatus === "error" ? "✗" : "?";
      const name = conn.name || conn.email || conn.displayName || t("menus.providers.unnamed");
      return `${name} (${status})`;
    },
    onSelect: async (conn) => {
      await showConnectionActions(conn, providerId, breadcrumb);
    },
    createAction: {
      label: t("menus.providers.addNew"),
      action: async () => {
        await handleAddConnection(providerId, authType);
      }
    }
  });
}

/**
 * Show actions for a specific connection
 * @param {Object} connection - Connection object
 * @param {string} providerId - Provider ID
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showConnectionActions(connection, providerId, breadcrumb = []) {
  const name = connection.name || connection.email || connection.displayName || t("menus.providers.unnamed");
  const status = connection.testStatus === "active" ? t("menus.providers.statusActive") :
                 connection.testStatus === "error" ? t("menus.providers.statusError") : t("menus.providers.statusUnknown");

  await showMenuWithBack({
    title: `🔌 ${name}`,
    breadcrumb: [...breadcrumb, name],
    headerContent: t("menus.providers.connHeader", { name, status }),
    items: [
      {
        label: t("menus.providers.rename"),
        action: async () => {
          const newName = await prompt(t("menus.providers.newNamePrompt", { name }));
          if (newName && newName.trim()) {
            showStatus(t("menus.providers.renaming"), "info");
            const result = await api.updateConnection(connection.id, { name: newName.trim() });
            if (result.success) {
              showStatus(t("menus.providers.renamed"), "success");
              connection.name = newName.trim();
            } else {
              showStatus(t("menus.providers.renameFailed", { error: result.error }), "error");
            }
            await pause();
          }
          return true;
        }
      },
      {
        label: t("menus.providers.test"),
        action: async () => {
          showStatus(t("menus.providers.testing"), "info");
          const result = await api.testConnection(connection.id);
          if (result.success) {
            showStatus(t("menus.providers.testOk"), "success");
          } else {
            showStatus(t("menus.providers.testFailed", { error: result.error }), "error");
          }
          await pause();
          return true;
        }
      },
      {
        label: t("menus.providers.delete"),
        action: async () => {
          const confirmed = await confirm(t("menus.providers.deleteConfirm", { name }));
          if (confirmed) {
            const result = await api.deleteConnection(connection.id);
            if (result.success) {
              showStatus(t("menus.providers.deleted"), "success");
            } else {
              showStatus(t("menus.providers.deleteFailed", { error: result.error }), "error");
            }
            await pause();
            return false; // Exit menu after delete
          }
          return true;
        }
      }
    ]
  });
}

/**
 * Handle adding new connection
 * @param {string} providerId - Provider ID
 * @param {string} authType - "oauth" or "apikey"
 */
// Providers that use Device Code Flow (terminal-based polling)
const DEVICE_CODE_PROVIDERS = ["github", "qwen", "kiro", "glm"];

/**
 * Handle adding new connection - auto-detect flow type
 * @param {string} providerId - Provider ID
 * @param {string} authType - "oauth" or "apikey"
 */
async function handleAddConnection(providerId, authType) {
  if (authType === "apikey") {
    await handleAddApiKeyConnection(providerId);
  } else {
    // OAuth: auto-detect flow type based on provider
    if (DEVICE_CODE_PROVIDERS.includes(providerId)) {
      // Device Code Flow for GitHub, Qwen, Kiro
      await handleAddDeviceCodeConnection(providerId);
    } else {
      // Authorization Code Flow for Claude, Codex, Gemini, etc.
      await handleAddOAuthConnection(providerId);
    }
  }
}

/**
 * Handle adding API Key connection
 * @param {string} providerId - Provider ID
 */
async function handleAddApiKeyConnection(providerId) {
  clearScreen();
  const provider = ALL_PROVIDERS[providerId];
  console.log(t("menus.providers.addApiKeyTitle", { name: provider.name }));

  const name = await prompt(t("menus.providers.connNamePrompt"));
  if (!name) {
    showStatus(t("menus.providers.cancelled"), "warning");
    await pause();
    return;
  }

  const apiKey = await prompt(t("menus.providers.apiKeyPrompt"));
  if (!apiKey) {
    showStatus(t("menus.providers.cancelled"), "warning");
    await pause();
    return;
  }

  showStatus(t("menus.providers.creating"), "info");

  const result = await api.createApiKeyProvider({
    provider: providerId,
    name,
    apiKey
  });

  if (result.success) {
    showStatus(t("menus.providers.created"), "success");
  } else {
    showStatus(t("menus.providers.failed", { error: result.error }), "error");
  }

  await pause();
}

/**
 * Handle adding OAuth Authorization Code connection
 * User opens URL manually and pastes callback URL
 * @param {string} providerId - Provider ID
 */
async function handleAddOAuthConnection(providerId) {
  clearScreen();
  const provider = ALL_PROVIDERS[providerId];
  
  // Step 1: Get auth URL
  showStatus(t("menus.providers.requestingAuthUrl"), "info");
  const authResult = await api.getOAuthAuthUrl(providerId);

  if (!authResult.success) {
    showStatus(t("menus.providers.failed", { error: authResult.error }), "error");
    await pause();
    return;
  }

  const authData = authResult.data || authResult;
  const authUrl = authData.authUrl;
  const codeVerifier = authData.codeVerifier;
  const state = authData.state;
  const redirectUri = authData.redirectUri;

  if (!authUrl) {
    showStatus(t("menus.providers.noAuthUrl"), "error");
    await pause();
    return;
  }

  // Step 2: Show URL and instructions
  clearScreen();
  showHeader(t("menus.providers.oauthLogin"), t("menus.providers.breadcrumbAdd", { name: provider.name }));

  console.log(`  ${COLORS.bold}${COLORS.cyan}1.${COLORS.reset} ${t("menus.providers.openUrlLine")}`);
  console.log(`     ${COLORS.dim}${authUrl}${COLORS.reset}`);
  if (copyToClipboard(authUrl)) {
    console.log(t("menus.providers.copied"));
  }
  console.log();
  console.log(`  ${COLORS.bold}${COLORS.cyan}2.${COLORS.reset} ${t("menus.providers.completeAuth")}`);
  console.log();
  console.log(`  ${COLORS.bold}${COLORS.cyan}3.${COLORS.reset} ${t("menus.providers.copyCallback")}`);
  console.log(t("menus.providers.callbackLooksLike"));
  console.log();

  const callbackUrl = await prompt(t("menus.providers.pasteCallback"));
  if (!callbackUrl) {
    showStatus(t("menus.providers.cancelled"), "warning");
    await pause();
    return;
  }
  
  // Step 3: Parse callback URL and extract code
  let code, urlState, error;
  try {
    const url = new URL(callbackUrl.trim());
    code = url.searchParams.get("code");
    urlState = url.searchParams.get("state");
    error = url.searchParams.get("error");
    
    if (error) {
      const errorDesc = url.searchParams.get("error_description") || error;
      showStatus(t("menus.providers.authFailed", { error: errorDesc }), "error");
      await pause();
      return;
    }

    if (!code) {
      showStatus(t("menus.providers.noCode"), "error");
      await pause();
      return;
    }
  } catch (err) {
    showStatus(t("menus.providers.invalidUrl"), "error");
    await pause();
    return;
  }

  // Step 4: Exchange code for tokens
  console.log();
  showStatus(t("menus.providers.exchanging"), "info");
  const exchangeResult = await api.exchangeOAuthCode(providerId, {
    code,
    redirectUri,
    codeVerifier,
    state: urlState || state
  });
  
  if (exchangeResult.success) {
    showStatus(t("menus.providers.created"), "success");
  } else {
    showStatus(t("menus.providers.failed", { error: exchangeResult.error }), "error");
  }

  await pause();
}

/**
 * Handle adding OAuth Device Code connection
 * @param {string} providerId - Provider ID
 */
async function handleAddDeviceCodeConnection(providerId) {
  clearScreen();
  const provider = ALL_PROVIDERS[providerId];
  
  // Step 1: Request device code
  showStatus(t("menus.providers.requestingDeviceCode"), "info");
  const deviceResult = await api.getOAuthDeviceCode(providerId);

  if (!deviceResult.success) {
    showStatus(t("menus.providers.failed", { error: deviceResult.error }), "error");
    await pause();
    return;
  }
  
  const deviceData = deviceResult.data || deviceResult;
  const device_code = deviceData.device_code;
  const user_code = deviceData.user_code;
  const verification_uri = deviceData.verification_uri;
  const verification_uri_complete = deviceData.verification_uri_complete;
  const codeVerifier = deviceData.codeVerifier;
  const extraData = deviceData.extraData || deviceData;
  
  if (!device_code) {
    showStatus(t("menus.providers.noDeviceCode"), "error");
    await pause();
    return;
  }

  // Step 2: Show instructions
  clearScreen();
  const deviceUrl = verification_uri_complete || verification_uri;
  showHeader(t("menus.providers.deviceLogin"), t("menus.providers.breadcrumbAdd", { name: provider.name }));

  console.log(`  ${COLORS.bold}${COLORS.cyan}1.${COLORS.reset} ${t("menus.providers.open")} ${COLORS.dim}${deviceUrl}${COLORS.reset}`);
  if (copyToClipboard(deviceUrl)) {
    console.log(t("menus.providers.copied"));
  }
  console.log();
  if (!verification_uri_complete && user_code) {
    console.log(`  ${COLORS.bold}${COLORS.cyan}2.${COLORS.reset} ${t("menus.providers.enterCode")} ${COLORS.bold}${user_code}${COLORS.reset}`);
    console.log();
  }
  console.log(`  ${COLORS.dim}${t("menus.providers.waitingAuth")}${COLORS.reset}`);
  console.log();
  
  // Step 3: Poll for token
  const maxAttempts = 60; // 5 minutes (5s interval)
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const pollResult = await api.pollOAuthToken(providerId, {
      deviceCode: device_code,
      codeVerifier,
      extraData
    });
    
    if (pollResult.success) {
      showStatus(t("menus.providers.createdNl"), "success");
      await pause();
      return;
    }

    // Check if still pending (pending flag is at root level, not in data)
    const isPending = pollResult.pending || pollResult.error === "authorization_pending" || pollResult.error === "slow_down";
    if (!isPending) {
      showStatus(t("menus.providers.failedNl", { error: pollResult.error || t("menus.providers.unknownError") }), "error");
      await pause();
      return;
    }

    process.stdout.write(".");
  }

  showStatus(t("menus.providers.timeout"), "error");
  await pause();
}

// ============================================================================
// CUSTOM PROVIDERS (provider nodes)
// ============================================================================

const CUSTOM_NODE_TYPES = ["openai-compatible", "anthropic-compatible"];
const OPENAI_API_TYPES = ["chat", "responses"];

/**
 * Show custom providers section in main providers menu
 * @param {Array} nodes - List of provider nodes
 * @param {Array} connections - All connections
 * @param {Array<string>} breadcrumb
 */
async function showCustomProvidersMenu(breadcrumb = []) {
  const { showListMenu } = require("../utils/menuHelper");

  await showListMenu({
    title: t("menus.providers.customTitle"),
    breadcrumb,
    backLabel: t("menus.providers.back"),
    fetchItems: async () => {
      const res = await api.getProviderNodes();
      if (!res.success) return { items: [] };
      return { items: res.data.nodes || res.data || [] };
    },
    formatItem: (node) => `[${node.prefix}] ${node.name} (${node.type})`,
    onSelect: async (node) => {
      await showCustomNodeDetail(node, [...breadcrumb, node.name]);
    },
    createAction: {
      label: t("menus.providers.addCustom"),
      action: async () => {
        await handleAddCustomNode();
      }
    }
  });
}

/**
 * Show detail menu for a custom provider node
 */
async function showCustomNodeDetail(node, breadcrumb = []) {
  await showMenuWithBack({
    title: `🔧 ${node.name}`,
    breadcrumb,
    headerContent: [
      t("menus.providers.typeLabel", { value: node.type }),
      t("menus.providers.prefixLabel", { value: `${COLORS.cyan}${node.prefix}${COLORS.reset}` }),
      t("menus.providers.baseUrlLabel", { value: `${COLORS.dim}${node.baseUrl}${COLORS.reset}` }),
    ].join("\n"),
    items: [
      {
        label: t("menus.providers.connections"),
        action: async () => {
          await showCustomNodeConnections(node, breadcrumb);
          return true;
        }
      },
      {
        label: t("menus.providers.editNode"),
        action: async () => {
          await handleEditCustomNode(node);
          return true;
        }
      },
      {
        label: t("menus.providers.deleteNode"),
        action: async () => {
          const confirmed = await confirm(t("menus.providers.deleteNodeConfirm", { name: node.name }));
          if (confirmed) {
            const res = await api.deleteProviderNode(node.id);
            if (res.success) {
              showStatus(t("menus.providers.nodeDeleted"), "success");
            } else {
              showStatus(t("menus.providers.deleteFailed", { error: res.error }), "error");
            }
            await pause();
            return false;
          }
          return true;
        }
      }
    ]
  });
}

/**
 * Show connections for a custom provider node
 */
async function showCustomNodeConnections(node, breadcrumb = []) {
  const { showListMenu } = require("../utils/menuHelper");

  await showListMenu({
    title: t("menus.providers.nodeConnectionsTitle", { name: node.name }),
    breadcrumb,
    backLabel: t("menus.providers.backShort"),
    fetchItems: async () => {
      const res = await api.getProviders();
      if (!res.success) return { items: [] };
      const all = res.data.connections || [];
      const items = all.filter(c => c.provider === node.id);
      return { items };
    },
    formatItem: (conn) => {
      const status = conn.testStatus === "active" ? "✓" : conn.testStatus === "error" ? "✗" : "?";
      return `${conn.name || t("menus.providers.unnamed")} (${status})`;
    },
    onSelect: async (conn) => {
      await showConnectionActions(conn, node.id, breadcrumb);
    },
    createAction: {
      label: t("menus.providers.addApiKeyConn"),
      action: async () => {
        await handleAddCustomNodeConnection(node);
      }
    }
  });
}

/**
 * Add API key connection to a custom provider node
 */
async function handleAddCustomNodeConnection(node) {
  clearScreen();
  console.log(t("menus.providers.addToNodeTitle", { name: node.name }));

  const name = await prompt(t("menus.providers.connNamePrompt"));
  if (!name) { showStatus(t("menus.providers.cancelled"), "warning"); await pause(); return; }

  const apiKey = await prompt(t("menus.providers.apiKeyPrompt"));
  if (!apiKey) { showStatus(t("menus.providers.cancelled"), "warning"); await pause(); return; }

  showStatus(t("menus.providers.creating"), "info");
  const res = await api.createApiKeyProvider({ provider: node.id, name, apiKey });

  showStatus(res.success ? t("menus.providers.createdShort") : t("menus.providers.failed", { error: res.error }), res.success ? "success" : "error");
  await pause();
}

/**
 * Handle adding a new custom provider node
 */
async function handleAddCustomNode() {
  clearScreen();
  console.log(t("menus.providers.addCustomTitle"));

  // Step 1: Select type
  const typeChoices = CUSTOM_NODE_TYPES.map((item, i) => `  ${i + 1}. ${item}`).join("\n");
  console.log(`${t("menus.providers.selectType")}\n${typeChoices}\n`);
  const typeInput = await prompt(t("menus.providers.typePrompt"));
  const typeIdx = parseInt(typeInput) - 1;
  if (isNaN(typeIdx) || !CUSTOM_NODE_TYPES[typeIdx]) {
    showStatus(t("menus.providers.cancelled"), "warning"); await pause(); return;
  }
  const type = CUSTOM_NODE_TYPES[typeIdx];

  // Step 2: Inputs
  const name = await prompt(t("menus.providers.namePrompt"));
  if (!name) { showStatus(t("menus.providers.cancelled"), "warning"); await pause(); return; }

  const prefix = await prompt(t("menus.providers.prefixPrompt"));
  if (!prefix) { showStatus(t("menus.providers.cancelled"), "warning"); await pause(); return; }

  const baseUrl = await prompt(t("menus.providers.baseUrlPrompt"));
  if (!baseUrl) { showStatus(t("menus.providers.cancelled"), "warning"); await pause(); return; }

  // Step 3: API type (OpenAI only)
  let apiType;
  if (type === "openai-compatible") {
    const apiTypeChoices = OPENAI_API_TYPES.map((item, i) => `  ${i + 1}. ${item}`).join("\n");
    console.log(`${t("menus.providers.apiTypeHeader")}${apiTypeChoices}\n`);
    const apiTypeInput = await prompt(t("menus.providers.apiTypePrompt"));
    const apiTypeIdx = parseInt(apiTypeInput) - 1;
    apiType = OPENAI_API_TYPES[apiTypeIdx] || "chat";
  }

  showStatus(t("menus.providers.creatingNode"), "info");
  const body = { name, prefix, baseUrl, type, ...(apiType && { apiType }) };
  const res = await api.createProviderNode(body);

  showStatus(res.success ? t("menus.providers.providerCreated") : t("menus.providers.failed", { error: res.error }), res.success ? "success" : "error");
  await pause();
}

/**
 * Handle editing a custom provider node
 */
async function handleEditCustomNode(node) {
  clearScreen();
  console.log(t("menus.providers.editTitle", { name: node.name }));
  console.log(`${COLORS.dim}${t("menus.providers.leaveBlank")}${COLORS.reset}\n`);

  const name = await prompt(t("menus.providers.nameCurrent", { current: node.name }));
  const baseUrl = await prompt(t("menus.providers.baseUrlCurrent", { current: node.baseUrl }));
  const prefix = await prompt(t("menus.providers.prefixCurrent", { current: node.prefix }));

  const updates = {};
  if (name && name.trim()) updates.name = name.trim();
  if (baseUrl && baseUrl.trim()) updates.baseUrl = baseUrl.trim();
  if (prefix && prefix.trim()) updates.prefix = prefix.trim();

  if (!Object.keys(updates).length) {
    showStatus(t("menus.providers.noChanges"), "warning"); await pause(); return;
  }

  showStatus(t("menus.providers.updating"), "info");
  const res = await api.updateProviderNode(node.id, updates);
  if (res.success) {
    Object.assign(node, updates);
    showStatus(t("menus.providers.updated"), "success");
  } else {
    showStatus(t("menus.providers.failed", { error: res.error }), "error");
  }
  await pause();
}

module.exports = { showProvidersMenu };
