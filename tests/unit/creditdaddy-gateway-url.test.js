// CreditDaddy 本地网关线的 URL 解析护栏。
//
// v1.3.4 新增 trae-free 时，注册表 + base.js 都加了该线，但漏了 default.js 的同名
// 分支——而 trae-free 没有专属 executor（`executors/index.js` 里注册的是另一个
// provider `trae`，走 core-normal.trae.ai），实际由 DefaultExecutor 承接，于是
// baseUrl 覆盖被静默忽略、请求仍打到注册表默认 transport。发布后才暴露出来。
//
// 这份测试参数化覆盖全部 CreditDaddy 线，并在 BaseExecutor 与 DefaultExecutor
// 两个实现上都断言：两处 buildUrl 是重复逻辑，任一处漏掉新线都会红。
import { describe, expect, it } from "vitest";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

// 权威来源：注册表里把本地网关指向 CreditDaddy daemon(127.0.0.1:47860) 的 provider。
// 用 host+port 匹配而不是匹配 "/gateway/"——kilo-gateway 的远程 URL 里也含
// "/gateway/"，按路径挑会把它误抓进来。
const CREDITDADDY_LINES = REGISTRY.filter(
  (p) => typeof p.transport?.baseUrl === "string" && /^http:\/\/127\.0\.0\.1:47860\//.test(p.transport.baseUrl),
);

describe("CreditDaddy gateway lines — baseUrl override", () => {
  it("every local-gateway line is covered by the buildUrl override (BaseExecutor + DefaultExecutor)", () => {
    // v1.3.4 加 trae-free 时 base.js 改了、default.js 漏了（trae-free 无专属
    // executor，实际走 DefaultExecutor），发布后才发现 baseUrl 覆盖被忽略。
    // 两个实现都是重复逻辑，这里都断言：任一处漏掉新线都会红。
    expect(CREDITDADDY_LINES.map((p) => p.id).sort()).toEqual([
      "minimax-free", "trae-free", "zcode-free",
    ]);
    for (const p of CREDITDADDY_LINES) {
      for (const Ctor of [DefaultExecutor]) {
        const exec = new Ctor(p.id);
        const url = exec.buildUrl(null, true, 0, {
          providerSpecificData: { baseUrl: "http://10.0.0.9:47860/gateway/custom/v1/messages" },
        });
        expect(url, `${p.id} via ${Ctor.name}`).toBe(
          "http://10.0.0.9:47860/gateway/custom/v1/messages",
        );
      }
    }
  });

  it("the BaseExecutor branch covers the same lines (duplicate logic, same contract)", () => {
    // 直接测基类分支：BaseExecutor 需要 config，构造一个最小的即可走 override 分支。
    for (const p of CREDITDADDY_LINES) {
      const base = new BaseExecutor(p.id);
      base.config = { ...p.transport };
      expect(
        base.buildUrl(null, true, 0, {
          providerSpecificData: { baseUrl: "http://10.0.0.9:47860/gateway/custom/v1/messages" },
        }),
        p.id,
      ).toBe("http://10.0.0.9:47860/gateway/custom/v1/messages");
    }
  });

  it("appends /messages when the configured path has no suffix", () => {
    for (const p of CREDITDADDY_LINES) {
      const exec = new DefaultExecutor(p.id);
      expect(
        exec.buildUrl(null, true, 0, {
          providerSpecificData: { baseUrl: "http://127.0.0.1:47860/gateway/x/v1" },
        }),
        p.id,
      ).toBe("http://127.0.0.1:47860/gateway/x/v1/messages");
    }
  });

  it("falls back to the registry transport when no override is configured", () => {
    for (const p of CREDITDADDY_LINES) {
      // 无 credentials → 走注册表默认（各线独立的 /gateway/<line>/v1/messages）。
      expect(new DefaultExecutor(p.id).buildUrl(null, true), p.id).toBe(p.transport.baseUrl);
    }
  });

  it("a trailing slash on the override does not double up", () => {
    for (const p of CREDITDADDY_LINES) {
      expect(
        new DefaultExecutor(p.id).buildUrl(null, true, 0, {
          providerSpecificData: { baseUrl: "http://127.0.0.1:47860/gateway/x/v1/messages/" },
        }),
        p.id,
      ).toBe("http://127.0.0.1:47860/gateway/x/v1/messages");
    }
  });
});
