import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mapCountryToXiaomiTokenplanRegion,
  getEgressRegion,
  _resetEgressRegionCache,
  GEOIP_PROVIDERS,
} from "../../src/lib/network/egressRegion.js";

describe("egressRegion multi-source fallback", () => {
  beforeEach(() => {
    _resetEgressRegionCache();
  });

  describe("mapCountryToXiaomiTokenplanRegion", () => {
    it("maps Greater China countries to cn", () => {
      expect(mapCountryToXiaomiTokenplanRegion("CN")).toBe("cn");
      expect(mapCountryToXiaomiTokenplanRegion("cn")).toBe("cn");
      expect(mapCountryToXiaomiTokenplanRegion("HK")).toBe("cn");
      expect(mapCountryToXiaomiTokenplanRegion("MO")).toBe("cn");
      expect(mapCountryToXiaomiTokenplanRegion("TW")).toBe("cn");
    });

    it("maps European countries to ams", () => {
      expect(mapCountryToXiaomiTokenplanRegion("NL")).toBe("ams");
      expect(mapCountryToXiaomiTokenplanRegion("DE")).toBe("ams");
      expect(mapCountryToXiaomiTokenplanRegion("FR")).toBe("ams");
      expect(mapCountryToXiaomiTokenplanRegion("GB")).toBe("ams");
    });

    it("maps other countries to sgp default", () => {
      expect(mapCountryToXiaomiTokenplanRegion("SG")).toBe("sgp");
      expect(mapCountryToXiaomiTokenplanRegion("US")).toBe("sgp");
      expect(mapCountryToXiaomiTokenplanRegion("JP")).toBe("sgp");
      expect(mapCountryToXiaomiTokenplanRegion("")).toBe("sgp");
      expect(mapCountryToXiaomiTokenplanRegion(null)).toBe("sgp");
    });
  });

  describe("getEgressRegion fallback chain", () => {
    it("succeeds with first provider (ip.sb)", async () => {
      const mockFetch = vi.fn().mockImplementation(async (url) => {
        if (url === "https://api.ip.sb/geoip") {
          return {
            ok: true,
            json: async () => ({
              country_code: "CN",
              country: "China",
              ip: "1.2.3.4",
            }),
          };
        }
        return { ok: false, status: 500 };
      });

      const res = await getEgressRegion({ fetchFn: mockFetch });
      expect(res).toEqual({
        countryCode: "CN",
        country: "China",
        ip: "1.2.3.4",
        source: "ip.sb",
        recommendedRegions: {
          "xiaomi-tokenplan": "cn",
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Cache hit
      const cached = await getEgressRegion({ fetchFn: mockFetch });
      expect(cached).toEqual(res);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("falls back to second provider (ipwho.is) when first fails", async () => {
      const mockFetch = vi.fn().mockImplementation(async (url) => {
        if (url === "https://api.ip.sb/geoip") {
          throw new Error("Timeout");
        }
        if (url === "https://ipwho.is/") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              country_code: "NL",
              country: "Netherlands",
              ip: "5.6.7.8",
            }),
          };
        }
        return { ok: false, status: 500 };
      });

      const res = await getEgressRegion({ fetchFn: mockFetch });
      expect(res).toEqual({
        countryCode: "NL",
        country: "Netherlands",
        ip: "5.6.7.8",
        source: "ipwho.is",
        recommendedRegions: {
          "xiaomi-tokenplan": "ams",
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("falls back to third provider (ipapi.is) when first two fail", async () => {
      const mockFetch = vi.fn().mockImplementation(async (url) => {
        if (url === "https://api.ip.sb/geoip" || url === "https://ipwho.is/") {
          return { ok: false, status: 429 };
        }
        if (url === "https://api.ipapi.is") {
          return {
            ok: true,
            json: async () => ({
              ip: "9.10.11.12",
              location: {
                country_code: "SG",
                country: "Singapore",
              },
            }),
          };
        }
        return { ok: false, status: 500 };
      });

      const res = await getEgressRegion({ fetchFn: mockFetch });
      expect(res).toEqual({
        countryCode: "SG",
        country: "Singapore",
        ip: "9.10.11.12",
        source: "ipapi.is",
        recommendedRegions: {
          "xiaomi-tokenplan": "sgp",
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("fails open and returns null when all providers fail", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network down"));
      const res = await getEgressRegion({ fetchFn: mockFetch });
      expect(res).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(GEOIP_PROVIDERS.length);
    });
  });
});
