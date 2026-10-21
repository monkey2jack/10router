import { describe, it, expect, vi } from "vitest";

// localDb is dynamically imported inside runMinimaxCheckinTick; mock it so the
// tick can be driven with a fixed connection set (and persistence is a no-op).
const mockConns = [];
vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections: async () => mockConns,
  updateSettings: async () => ({}),
  getSettings: async () => ({}),
}));

import {
  isEligibleMinimaxConnection,
  checkinOneMinimax,
  runMinimaxCheckinTick,
} from "../../src/sse/services/minimaxCheckin.js";
import { signedAccountRequest } from "../../open-sse/services/usage/minimax-code.js";

// Status shape from agent.minimax.cn /minimax-cloud/api/v1/signin/status
// (fact source: CreditDaddy src/minimaxClient.js, issue #75).
function statusPayload(todayStatus = 1, dayNo = 3, points = 20, bonus = 0) {
  return {
    base_resp: { status_code: 0 },
    data: { days: [{ is_today: true, status: todayStatus, day_no: dayNo, points, bonus_points: bonus }] },
  };
}

describe("minimaxCheckin unit tests", () => {
  describe("isEligibleMinimaxConnection", () => {
    it("accepts active minimax-code / minimax-code-global with accessToken", () => {
      expect(isEligibleMinimaxConnection({ provider: "minimax-code", accessToken: "at-1", isActive: true })).toBe(true);
      expect(isEligibleMinimaxConnection({ provider: "minimax-code-global", accessToken: "at-2", isActive: true })).toBe(true);
    });

    it("rejects inactive, non-minimax, tokenless connections", () => {
      expect(isEligibleMinimaxConnection({ provider: "minimax-code", accessToken: "at-1", isActive: false })).toBe(false);
      expect(isEligibleMinimaxConnection({ provider: "qoder", accessToken: "dt-1", isActive: true })).toBe(false);
      expect(isEligibleMinimaxConnection({ provider: "minimax-code", apiKey: "sk-1", isActive: true })).toBe(false);
      expect(isEligibleMinimaxConnection(null)).toBe(false);
    });

    it("never sweeps minimax-free — the no-auth gateway line is CreditDaddy's closed loop", () => {
      // 签到与配额都在 CD 内闭环；10R 侧调度器即使误配置也扫不到它。
      expect(isEligibleMinimaxConnection({ provider: "minimax-free", accessToken: "at-1", isActive: true })).toBe(false);
      expect(isEligibleMinimaxConnection({ provider: "minimax-free", apiKey: "x", isActive: true })).toBe(false);
    });
  });

  describe("checkinOneMinimax", () => {
    it("claims when today is pending (status 1)", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => statusPayload(1, 3, 20, 5) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ base_resp: { status_code: 0 }, data: { claim_result: 1, day_no: 3, points: 25 } }) });

      const out = await checkinOneMinimax(
        { id: "c1", provider: "minimax-code", accessToken: "at-1" },
        { fetch: mockFetch },
      );
      expect(out.status).toBe("checked-in");
      expect(out.claimedAmount).toBe(25);
      // Second call hits the claim endpoint with a POST-signed request
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("reports already when status says claimed (status 3)", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => statusPayload(3, 4, 20, 5) });

      const out = await checkinOneMinimax(
        { id: "c1", provider: "minimax-code", accessToken: "at-1" },
        { fetch: mockFetch },
      );
      expect(out.status).toBe("already");
      expect(mockFetch).toHaveBeenCalledTimes(1); // no claim call
    });

    it("treats claim_result=2 as already (duplicate claim)", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => statusPayload(1, 2, 20) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ base_resp: { status_code: 0 }, data: { claim_result: 2, day_no: 2, points: 20 } }) });

      const out = await checkinOneMinimax(
        { id: "c1", provider: "minimax-code", accessToken: "at-1" },
        { fetch: mockFetch },
      );
      expect(out.status).toBe("already");
    });

    it("fails on auth errors (401) without claiming", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 401 });

      const out = await checkinOneMinimax(
        { id: "c1", provider: "minimax-code-global", accessToken: "expired" },
        { fetch: mockFetch },
      );
      expect(out.status).toBe("failed");
      expect(out.error).toMatch(/Authentication failed/);
    });

    it("signs the status request against the right agent origin per line", async () => {
      let capturedUrl = "";
      const mockFetch = vi.fn((url) => {
        capturedUrl = String(url);
        return Promise.resolve({ ok: true, status: 200, json: async () => statusPayload(3, 1, 10) });
      });
      await checkinOneMinimax(
        { id: "c1", provider: "minimax-code-global", accessToken: "at-g" },
        { fetch: mockFetch },
      );
      expect(capturedUrl).toContain("https://agent.minimax.io/minimax-cloud/api/v1/signin/status");
      expect(capturedUrl).toContain("client=mcode");
    });

    it("status is a GET and claim is a POST — the wrong verb is a bare 404", async () => {
      // 实测 2026-10-20：signin/status 只认 GET（POST → 404 "Not Found"），
      // signin/claim 只认 POST（GET → 404）。曾两者都发 POST，状态查询必 404。
      const calls = [];
      const mockFetch = vi.fn((url, init) => {
        calls.push({ url: String(url), method: init?.method, body: init?.body });
        return Promise.resolve(calls.length === 1
          ? { ok: true, status: 200, json: async () => statusPayload(1, 3, 20, 5) }
          : { ok: true, status: 200, json: async () => ({ base_resp: { status_code: 0 }, data: { claim_result: 1, day_no: 3, points: 25 } }) });
      });
      await checkinOneMinimax(
        { id: "c1", provider: "minimax-code", accessToken: "at-1", providerSpecificData: { realUserID: "u42" } },
        { fetch: mockFetch },
      );
      expect(calls[0].url).toContain("/signin/status");
      expect(calls[0].method).toBe("GET");
      expect(calls[0].body).toBeUndefined();
      expect(calls[1].url).toContain("/signin/claim");
      expect(calls[1].method).toBe("POST");
      // userID rides the signed query like the membership probe
      expect(calls[0].url).toContain("user_id=u42");
    });

    it("matches the reference signing from signedAccountRequest (cn line)", async () => {
      // The signin request must be signed exactly like the membership probe —
      // same yy/x-signature derivation, different path.
      const { url, init } = signedAccountRequest(
        { agent: "https://agent.minimax.cn", lang: "zh" },
        "/minimax-cloud/api/v1/signin/status",
        { access: "at-1" },
      );
      expect(url).toContain("https://agent.minimax.cn/minimax-cloud/api/v1/signin/status");
      expect(init.method).toBe("GET");
      expect(init.headers.Authorization).toBe("Bearer at-1");
      expect(init.headers["x-signature"]).toMatch(/^[0-9a-f]{32}$/);
      expect(init.headers.yy).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("runMinimaxCheckinTick", () => {
    it("sweeps eligible connections and memoizes confirmed ones", async () => {
      mockConns.length = 0;
      mockConns.push(
        { id: "m1", provider: "minimax-code", accessToken: "at-1", isActive: true },
        { id: "m2", provider: "minimax-code", accessToken: "at-2", isActive: true },
      );

      let calls = 0;
      const outcomes = [
        { connectionId: "m1", status: "checked-in", claimedAmount: 20 },
        { connectionId: "m2", status: "already", claimedAmount: 0 },
      ];
      const results = await runMinimaxCheckinTick({
        checkinConnection: async () => outcomes[calls++],
      });
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe("checked-in");
      expect(results[1].status).toBe("already");
    });

    it("skips non-minimax connections entirely", async () => {
      mockConns.length = 0;
      mockConns.push({ id: "q1", provider: "qoder", accessToken: "dt-1", isActive: true });

      const results = await runMinimaxCheckinTick({
        checkinConnection: async () => { throw new Error("should not be called"); },
      });
      expect(results).toHaveLength(0);
    });

    it("skips minimax-free (CreditDaddy closed loop) even if a stray connection exists", async () => {
      mockConns.length = 0;
      mockConns.push({ id: "mf1", provider: "minimax-free", accessToken: "whatever", isActive: true });

      const results = await runMinimaxCheckinTick({
        checkinConnection: async () => { throw new Error("should not be called"); },
      });
      expect(results).toHaveLength(0);
    });
  });
});
