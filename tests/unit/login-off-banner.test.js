// The "log-in check is off" banner can be hidden — but only on purpose, and
// only for the current off-period.
//
// Users asked to dismiss the red dashboard-wide banner once they had knowingly
// turned the log-in check off. The switch sits under "Require login", appears
// only while the check is off, takes a confirmation to hide the banner, and the
// server forgets the choice as soon as the check goes back on — so switching it
// off again later warns again.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, updateSettings: mocks.updateSettings }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));

const { PATCH } = await import("../../src/app/api/settings/route.js");

const readSource = (relative) => fs.readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");
const patch = (body) =>
  PATCH(new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));

describe("settings PATCH: the hidden banner never outlives its off-period", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A stored password: since issue #33 the check cannot be turned on without one.
    mocks.getSettings.mockResolvedValue({ password: "$2a$04$stored-hash" });
    mocks.updateSettings.mockImplementation(async (u) => ({ requireLogin: true, ...u }));
  });

  it("turning the log-in check back on clears hideLoginOffBanner", async () => {
    await patch({ requireLogin: true });
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ requireLogin: true, hideLoginOffBanner: false }));
  });

  it("…even when the same request tries to keep it hidden", async () => {
    await patch({ requireLogin: true, hideLoginOffBanner: true });
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ hideLoginOffBanner: false }));
  });

  it("hiding while the check is off is stored as sent", async () => {
    await patch({ hideLoginOffBanner: true });
    expect(mocks.updateSettings).toHaveBeenCalledWith({ hideLoginOffBanner: true });
  });

  it("turning the check off does not touch the flag", async () => {
    await patch({ requireLogin: false });
    expect(mocks.updateSettings).toHaveBeenCalledWith({ requireLogin: false });
  });
});

describe("the banner honors the flag and follows live changes", () => {
  const banner = readSource("src/shared/components/SecurityBanner.js");
  const status = readSource("src/app/api/security/status/route.js");

  it("the status probe reports the flag (default: not hidden)", () => {
    expect(status).toContain("hideLoginOffBanner: settings?.hideLoginOffBanner === true");
  });

  it("hides only the login-off warning, only when the flag is set", () => {
    expect(banner).toContain("if (loginOff && status.hideLoginOffBanner) return null;");
  });

  it("re-reads the status when the settings page signals a change", () => {
    expect(banner).toContain("window.addEventListener(SECURITY_STATUS_CHANGED, load)");
    expect(banner).toContain("window.removeEventListener(SECURITY_STATUS_CHANGED, load)");
  });
});

describe("settings page: hiding takes a confirmation, showing is immediate", () => {
  const profile = readSource("src/app/(dashboard)/dashboard/profile/page.js");

  it("only offers the switch while the log-in check is off", () => {
    const at = profile.indexOf('translate("Show the log-in-off warning banner")');
    expect(at).toBeGreaterThan(-1);
    expect(profile.lastIndexOf("{settings.requireLogin === false && (", at)).toBeGreaterThan(-1);
  });

  it("opens a confirmation instead of hiding straight away", () => {
    expect(profile).toContain("else setBannerHideConfirmOpen(true);");
    const confirmBlock = profile.slice(profile.indexOf("isOpen={bannerHideConfirmOpen}"));
    expect(confirmBlock.slice(0, 400)).toContain("updateHideLoginOffBanner(true)");
  });

  it("showing the banner again needs no dialog", () => {
    expect(profile).toContain("if (settings.hideLoginOffBanner === true) updateHideLoginOffBanner(false);");
  });

  it("both security switches tell the banner to refresh", () => {
    // require-login, banner switch, and "set a password and turn on" (issue #33).
    expect(profile.match(/window\.dispatchEvent\(new Event\(SECURITY_STATUS_CHANGED\)\)/g)).toHaveLength(3);
  });

  it("the dialog says the risk remains", () => {
    expect(profile).toContain("hiding the banner only removes the reminder, not the risk");
  });
});

describe("every new string has zh-CN and zh-TW text", () => {
  const literals = [
    "Show the log-in-off warning banner",
    "The red banner at the top of every page while the log-in check is off. Turning log-in back on shows it again next time.",
    "Hide the log-in-off warning?",
    "The dashboard stays open to anyone who can reach this port — hiding the banner only removes the reminder, not the risk. It comes back automatically if you turn the log-in check on and off again.",
    "Hide it",
  ];
  for (const locale of ["zh-CN", "zh-TW"]) {
    it(locale, () => {
      const table = JSON.parse(readSource(`public/i18n/literals/${locale}.json`));
      expect(literals.filter((k) => !table[k])).toEqual([]);
    });
  }
});
