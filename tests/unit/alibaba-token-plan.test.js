import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { getAlibabaTokenPlanUsage } from "../../open-sse/services/usage/misc.js";

/**
 * Issue #74：Alibaba Token Plan 之前只有国际版，国内版用户无处可连、只能自建
 * 自定义卡（连 401 都看不到原因）。国内版 key 打国际端点回 InvalidApiKey，
 * 反之亦然，所以两套必须各自成卡且名字标明区域。
 */
describe("Alibaba Token Plan 双区域", () => {
  const intl = REGISTRY.find((r) => r.id === "alitp-intl");
  const cn = REGISTRY.find((r) => r.id === "alitp-cn");

  it("国际版与国内版都存在且各自有独立端点", () => {
    expect(intl).toBeTruthy();
    expect(cn).toBeTruthy();
    expect(intl.transport.baseUrl).toContain("ap-southeast-1");
    expect(cn.transport.baseUrl).toContain("cn-beijing");
  });

  it("卡片名带区域标识，用户不会选错", () => {
    // 四张阿里系卡都不能只叫「Alibaba」，否则无法从界面区分国际/国内
    expect(intl.display.name).toBe("Alibaba Token Plan (Intl)");
    expect(cn.display.name).toBe("Alibaba Token Plan (CN)");
  });

  it("Coding / Studio 也带区域标识", () => {
    const names = REGISTRY.filter((r) => /^ali(code|ms)/.test(r.id))
      .map((r) => r.display.name);
    for (const n of names) expect(n).toMatch(/\((Intl|CN)\)$/);
  });
});

describe("Token Plan 配额说明（无公开额度 API）", () => {
  it("不编造额度：返回空 quotas + 指向控制台的说明", () => {
    const usage = getAlibabaTokenPlanUsage("alitp-cn");
    expect(usage.quotas).toEqual({});
    expect(usage.message).toContain("bailian.console.aliyun.com");
    expect(usage.message).toContain("免费额度");
  });

  it("国际版提示两套 key 互不通用", () => {
    const usage = getAlibabaTokenPlanUsage("alitp-intl");
    expect(usage.message).toContain("modelstudio.console.alibabacloud.com");
    expect(usage.message).toContain("401");
  });
});
