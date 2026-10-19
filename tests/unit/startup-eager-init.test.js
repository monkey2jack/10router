// The app must start with the server, not with the first page render.
//
// bootstrap (→ initializeApp: tunnel / Tailscale / MITM auto-resume, watchdog,
// usage cost repair) used to be reached only through the root layout's import,
// so after a restart all of it waited for someone to open a dashboard page — on
// the NAS 48 minutes after a restart, and never for an instance only called on
// /v1. instrumentation.register() runs once at server start; it now imports
// bootstrap, whose global guard keeps the layout import from starting it twice.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

const mocks = vi.hoisted(() => ({ initializeApp: vi.fn(async () => {}), initConsoleLogCapture: vi.fn() }));
vi.mock("../../src/shared/services/initializeApp.js", () => ({ default: mocks.initializeApp }));
vi.mock("@/lib/consoleLogBuffer", () => ({ initConsoleLogCapture: mocks.initConsoleLogCapture }));

const ENV_KEYS = ["NEXT_RUNTIME", "NEXT_PHASE"];
let savedEnv;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  delete global.__appBootstrapped;
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete global.__appBootstrapped;
});

describe("startup runs from instrumentation.register()", () => {
  it("the Node.js server starts the app at register time", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
    const { register } = await import("../../src/instrumentation.js");
    await register();
    expect(mocks.initConsoleLogCapture).toHaveBeenCalledTimes(1);
    expect(mocks.initializeApp).toHaveBeenCalledTimes(1);
  });

  it("the root layout's later import does not start it a second time", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.NEXT_PHASE;
    await (await import("../../src/instrumentation.js")).register();
    vi.resetModules(); // a separate bundle re-evaluating bootstrap, as the layout does
    await import("../../src/shared/services/bootstrap.js");
    expect(mocks.initializeApp).toHaveBeenCalledTimes(1);
  });

  it("the edge runtime starts nothing", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await (await import("../../src/instrumentation.js")).register();
    expect(mocks.initializeApp).not.toHaveBeenCalled();
  });

  it("a production build starts nothing (no cloudflared download during prerender)", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-build";
    await (await import("../../src/instrumentation.js")).register();
    expect(mocks.initializeApp).not.toHaveBeenCalled();
  });

  it("the layout keeps its import as a fallback", () => {
    const layout = fs.readFileSync(new URL("../../src/app/layout.js", import.meta.url), "utf8");
    expect(layout).toContain('import "@/shared/services/bootstrap"');
  });
});
