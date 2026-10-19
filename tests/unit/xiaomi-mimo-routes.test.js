import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = (rel) => path.join(here, "..", "..", rel);
const read = (rel) => fs.readFileSync(srcPath(rel), "utf-8");

describe("xiaomi-mimo api-key route", () => {
  const src = () => read("src/app/api/oauth/xiaomi-mimo/api-key/route.js");

  it("rejects keys without the sk- prefix", () => {
    expect(src()).toContain('startsWith("sk-")');
  });

  it("validates against the models endpoint but soft-fails", () => {
    expect(src()).toContain("AbortSignal.timeout(10000)");
    // A blocked network must not block the import.
    expect(src()).toMatch(/Network error — still allow import/);
  });

  it("reads the Desktop session passToken server-side — for the Desktop card only", () => {
    expect(src()).toContain("readDesktopPassToken");
    // …and gates the read on the card: the cloud row must never store a session.
    expect(src()).toContain("if (isDesktopCard && !session.passToken)");
    // The cloud card also ignores a client-sent passToken instead of storing it.
    expect(src()).toContain("isDesktopCard");
    expect(src()).toMatch(/sessionData = isDesktopCard/);
  });

  it("updates an existing connection instead of duplicating it", () => {
    expect(src()).toContain("updateProviderConnection");
    expect(src()).toContain("existing.id");
  });

  it("does not reflect upstream bodies on failure", () => {
    expect(src()).toContain("SSRF hardening");
  });

  it("reports a locked Desktop session without failing the import", () => {
    expect(src()).toContain('e?.code === "DESKTOP_LOCKED"');
    expect(src()).toContain("desktopLocked");
  });
});

describe("xiaomi-mimo auto-import route", () => {
  const src = () => read("src/app/api/oauth/xiaomi-mimo/auto-import/route.js");

  it("never returns the Desktop passToken to the client", () => {
    expect(src()).not.toMatch(/mimoPassToken:/);
    expect(src()).not.toMatch(/mimoUserId:/);
    expect(src()).not.toContain("providerSpecificData");
  });

  it("still reports whether a Desktop session was found", () => {
    expect(src()).toContain("hasDesktopSession");
    expect(src()).toContain("readDesktopPassToken");
  });

  it("checks the MiMoCode auth.json locations", () => {
    expect(src()).toContain("mimocode");
    expect(src()).toContain("auth.json");
  });

  it("tells the user to quit the Desktop app when its cookie store is locked", () => {
    expect(src()).toContain('e?.code === "DESKTOP_LOCKED"');
    expect(src()).toContain("desktopLocked");
    expect(src()).toMatch(/Quit the desktop app completely/);
    // A locked store must not fail the import — only the Preview session is missing.
    expect(src()).toContain("found: true");
  });
});

describe("xiaomi-mimo wiring in the generic oauth route", () => {
  const src = () => read("src/app/api/oauth/[provider]/[action]/route.js");

  it("starts the local proxy and registers a keypair on authorize", () => {
    expect(src()).toContain("startXiaomiMimoProxy");
    expect(src()).toContain("registerXiaomiMimoSession({ state, privateKeyDer })");
    expect(src()).toMatch(/return NextResponse\.json\(\{\s*authorizeUrl/);
    // Both URLs the official client hands its UI: the automatic one and the platform's
    // code-display page, so a user whose localhost callback is unreachable can still
    // get a copyable code from the page that is designed to show one.
    expect(src()).toContain("manualUrl: buildManualAuthorizeUrl(publicKey, keyName)");
  });

  it("redacts the API key from poll-status", () => {
    // The modal only needs truthiness; the key is applied server-side by /exchange.
    expect(src()).toContain("{ status: xm.status, result: { uid: xm.result.uid, baseUrl: xm.result.baseUrl } }");
    expect(src()).not.toMatch(/result: \{\s*\.\.\.xm\.result/);
  });

  it("keeps the session alive until exchange consumes it", () => {
    // Only the error branch may clear; the done branch must survive for /exchange.
    const src = read("src/app/api/oauth/[provider]/[action]/route.js");
    const done = src.slice(
      src.indexOf('if (xm.status === "done"'),
      src.indexOf('if (xm.status === "error"'),
    );
    expect(done).toContain("return NextResponse.json");
    expect(done).not.toContain("clearXiaomiMimoSession");
  });

  it("builds the connection from the decrypted session on exchange", () => {
    expect(src()).toContain('accessToken: session.result.accessToken');
    expect(src()).toContain("clearXiaomiMimoSession(state)");
    expect(src()).toContain("stopXiaomiMimoProxy()");
  });

  it("stops the proxy on stop-proxy", () => {
    // Both Xiaomi cards share this flow, so the branch tests family membership
    // rather than one literal id.
    expect(src()).toContain("else if (isXiaomiMimo(provider)) stopXiaomiMimoProxy();");
  });

  it("accepts a pasted authorization code and reports the session it opened", () => {
    expect(src()).toContain('if (action === "submit-code")');
    expect(src()).toContain("completeXiaomiMimoFlow(body?.code)");
    // The payload carries no state, so the client is told which session matched and
    // then finishes through /exchange — the sk- key itself must not be echoed back.
    expect(src()).toContain("state: outcome.state");
    expect(src()).toMatch(/result: \{ uid: outcome\.result\.uid, baseUrl: outcome\.result\.baseUrl \}/);
    expect(src()).not.toMatch(/accessToken: outcome\.result\.accessToken/);
  });

  it("serves submit-code for the Xiaomi cards only", () => {
    const source = src();
    const branch = source.slice(
      source.indexOf('if (action === "submit-code")'),
      source.indexOf('if (action === "exchange")'),
    );
    expect(branch).toContain("if (!isXiaomiMimo(provider))");
    expect(branch).toContain("status: 400");
  });

  it("keeps the submit-code messages translatable", () => {
    // These strings are returned by the API and echoed by the modal, so they are
    // translated by their own text as the key — but they live on the server, where
    // the modal's literal sweep cannot see them. Miss one and the UI shows a lone
    // English sentence, which is exactly what happened once.
    const source = src();
    const start = source.indexOf("const messages = {");
    const block = source.slice(start, source.indexOf("};", start));
    const messages = [...block.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(messages.length).toBeGreaterThanOrEqual(5);

    for (const locale of ["zh-CN", "zh-TW"]) {
      const map = JSON.parse(read(`public/i18n/literals/${locale}.json`));
      const missing = messages.filter((m) => !(m in map));
      expect(missing, `${locale} is missing: ${missing.join(" | ")}`).toEqual([]);
    }
  });
});

describe("xiaomi-mimo dashboard wiring", () => {
  it("exports the modal", () => {
    expect(read("src/shared/components/index.js")).toContain("XiaomiMimoAuthModal");
  });

  it("routes the provider's OAuth button to the dedicated modal", () => {
    const page = read("src/app/(dashboard)/dashboard/providers/[id]/page.js");
    expect(page).toContain("XiaomiMimoAuthModal");
    expect(page).toContain('providerId === "xiaomi-mimo"');
    expect(page).toContain("setShowXiaomiMimoModal(true)");
  });

  it("has the modal read credentials locally and fall back to browser sign-in", () => {
    const modal = read("src/shared/components/XiaomiMimoAuthModal.js");
    // The two static endpoints (local-credential read + import) stay on the
    // xiaomi-mimo dir for BOTH cards — the target card travels in the body.
    expect(modal).toContain("/api/oauth/xiaomi-mimo/auto-import");
    expect(modal).toContain("/api/oauth/xiaomi-mimo/api-key");
    // The browser flow is addressed by provider id so it can serve either card.
    expect(modal).toContain("/authorize?state=");
    expect(modal).toContain("/poll-status?state=");
    expect(modal).toContain("`/api/oauth/${providerId}/exchange`");
  });

  it("tells the user the credentials come from the local Desktop profile", () => {
    const modal = read("src/shared/components/XiaomiMimoAuthModal.js");
    expect(modal).toMatch(/Desktop/);
    expect(modal).toContain("hasDesktopSession");
  });

  it("offers a paste-code field for the platform's code page", () => {
    const modal = read("src/shared/components/XiaomiMimoAuthModal.js");
    // The platform may show a code instead of calling our localhost redirect, so
    // "Check Again" on its own would dead-end the user on that page.
    expect(modal).toContain("`/api/oauth/${providerId}/submit-code`");
    expect(modal).toContain("Submit Code");
    expect(modal).toContain("Check Again");
    expect(modal).toContain("<textarea");
    // The code carries no state, so the flow finishes with the session the server
    // reported rather than assuming the one the client generated.
    expect(modal).toContain("finishExchange(data.state || oauthState)");
  });

  it("never lets the sk- key itself reach the modal", () => {
    const modal = read("src/shared/components/XiaomiMimoAuthModal.js");
    // Local-credential import uses the auto-import `apiKey`; the browser flow only
    // ever sees the redacted { uid, baseUrl } and is applied server-side by /exchange.
    expect(modal).not.toContain("accessToken");
  });

  it("gives a failed paste a way forward instead of a dead end", () => {
    const modal = read("src/shared/components/XiaomiMimoAuthModal.js");
    // A code that will not decrypt means the attempt is stale, so re-issuing one has
    // to be reachable from the error state itself.
    const errorBlock = modal.slice(modal.indexOf("Recovery: a code that will not decrypt"), modal.indexOf("<div>"));
    expect(errorBlock).toContain("handleStartOAuth");
    // …and the length warning prevents most of those failures in the first place.
    expect(modal).toContain("The code is a long string (100+ characters) — copy it whole, using the Copy button on the sign-in page.");
  });

  it("translates every user-visible string it renders", () => {
    const modal = read("src/shared/components/XiaomiMimoAuthModal.js");
    expect(modal).toContain('import { translate } from "@/i18n/runtime"');

    // Every key the modal asks for must exist in the Chinese locales, otherwise
    // translate() silently falls back to English and the UI ships half-translated.
    const keys = [...modal.matchAll(/translate\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of ["zh-CN", "zh-TW"]) {
      const map = JSON.parse(read(`public/i18n/literals/${locale}.json`));
      const missing = [...new Set(keys)].filter((k) => !(k in map));
      expect(missing, `${locale} is missing: ${missing.join(" | ")}`).toEqual([]);
    }
  });

  it("surfaces the locked cookie store as an actionable step", () => {
    const modal = read("src/shared/components/XiaomiMimoAuthModal.js");
    expect(modal).toContain("desktopLocked");
    expect(modal).toMatch(/Quit Xiaomi MiMo Desktop and retry/);
  });

  it("does not forward the passToken from the modal", () => {
    expect(read("src/shared/components/XiaomiMimoAuthModal.js")).not.toContain("mimoPassToken");
  });
});

describe("MiMo three-card split", () => {
  it("routes both Xiaomi cards to the dedicated modal, passing the card id", () => {
    const page = read("src/app/(dashboard)/dashboard/providers/[id]/page.js");
    expect(page).toContain('providerId === "xiaomi-mimo" || providerId === "mimo-desktop"');
    expect(page).toContain("provider={providerId}");
  });

  it("creates the connection under the card the modal was opened for", () => {
    const modal = read("src/shared/components/XiaomiMimoAuthModal.js");
    expect(modal).toContain('const providerId = provider === "mimo-desktop" ? "mimo-desktop" : "xiaomi-mimo"');
    expect(modal).toContain("provider: providerId,");
    // The import route is told which card to store under, and falls back to the
    // base card rather than inventing an id.
    expect(read("src/app/api/oauth/xiaomi-mimo/api-key/route.js")).toContain(
      'requestedProvider === "mimo-desktop" ? "mimo-desktop" : "xiaomi-mimo"',
    );
  });

  it("shares one ECDH flow across both cards without hardcoding a provider id", () => {
    const src = read("src/app/api/oauth/[provider]/[action]/route.js");
    expect(src).toContain('const XIAOMI_MIMO_PROVIDERS = new Set(["xiaomi-mimo", "mimo-desktop"])');
    // No branch may still pin the literal id...
    expect(src).not.toContain('if (provider === "xiaomi-mimo")');
    // ...and connection writes must use the addressed card, not a literal.
    expect(src).not.toContain('provider: "xiaomi-mimo",');
    expect(src).toContain("await getProviderConnections({ provider })");
  });

  it("folds the Desktop session into the Desktop card only", () => {
    // The cloud card used to receive this machine's Desktop passToken on every
    // browser sign-in, which is what made it advertise a "Desktop Session" badge
    // and a weekly quota it does not own. The fold is now gated on the card.
    const src = read("src/app/api/oauth/[provider]/[action]/route.js");
    expect(src).toContain('const isDesktopCard = provider === "mimo-desktop"');
    expect(src).toContain("if (isDesktopCard) {");
    // The Desktop label rides the same gate — writing it on a cloud row was part
    // of the contamination.
    expect(src).toContain('...(isDesktopCard ? { provider: "Xiaomi MiMo Desktop" } : {})');
    // A re-auth on the cloud card also strips fields an older build folded in.
    expect(src).toContain("delete existingPsd.mimoPassToken;");
  });

  it("never stores a session (or honours session-only) on the cloud card via api-key", () => {
    const src = read("src/app/api/oauth/xiaomi-mimo/api-key/route.js");
    expect(src).toContain("const isDesktopCard = targetProvider === \"mimo-desktop\"");
    // session-only is a Desktop-card concept only.
    expect(src).toContain("isDesktopCard && (sessionOnly === true");
    // And a client-sent passToken is ignored for the cloud card instead of stored.
    expect(src).toContain("let session = isDesktopCard");
    expect(src).toContain("const sessionData = isDesktopCard");
  });

  it("never runs the Desktop credential import for the cloud card", () => {
    // `xiaomi-mimo` bills the cloud API, so the Desktop branch's screens ("quit
    // MiMo Desktop" and the credential-lock notice) have no business appearing on
    // it. Its phase is DERIVED to "cloud", which
    // also means a stale `phase` left over from the other card cannot leak through.
    const modal = read("src/shared/components/XiaomiMimoAuthModal.js");
    expect(modal).toContain('const effectivePhase = isDesktopCard ? phase : "cloud"');
    expect(modal).toContain('if (!isDesktopCard) return;');
    // Every screen must switch on the derived phase; a raw `{phase === ` would
    // let the Desktop screens render on the cloud card again.
    expect(modal).toContain("{effectivePhase === \"cloud\"");
    expect(modal).not.toContain("{phase === ");
  });

  it("offers no browser authorization on the Desktop card", () => {
    // The Desktop card's models are reachable only through the account session: an
    // sk- key never reaches its account-service route, and the browser sign-in is
    // the CLOUD card's path. The detecting/found/not-found screens render for the
    // Desktop card only, so no browser affordance may live in them.
    const modal = read("src/shared/components/XiaomiMimoAuthModal.js");
    const foundAt = modal.indexOf('{effectivePhase === "found"');
    const cloudAt = modal.indexOf('{effectivePhase === "cloud"');
    expect(foundAt).toBeGreaterThan(-1);
    expect(cloudAt).toBeGreaterThan(-1);
    expect(cloudAt).toBeLessThan(foundAt); // cloud screen is defined first

    // The browser-auth block still exists — the cloud screen needs it...
    expect(modal).toContain("renderBrowserAuth");

    // ...but every affordance is gone from the Desktop-only screens.
    const desktopScreens = modal.slice(foundAt);
    expect(desktopScreens).not.toContain("Add Browser Authorization");
    expect(desktopScreens).not.toContain("Sign in via Browser");
    expect(desktopScreens).not.toContain("handleStartOAuth");
    // Same for the copy that used to point at the browser flow: it must send the
    // user to the sibling card instead.
    expect(desktopScreens).not.toContain("Or sign in via browser below.");
    expect(desktopScreens).not.toContain("Preview models");
  });
});
