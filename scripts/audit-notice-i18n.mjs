// 一次性审计:registry 里所有 display.notice.text 与 zh-CN/zh-TW 字典的覆盖差。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REG = "open-sse/providers/registry";
const files = readdirSync(REG).filter((f) => f.endsWith(".js") && f !== "index.js");

const texts = new Map(); // text -> [provider ids]
for (const f of files) {
  const src = readFileSync(join(REG, f), "utf8");
  // notice 块里的 text 字段:双引号单行串(注册表惯例)
  for (const m of src.matchAll(/text:\s*"((?:[^"\\]|\\.)*)"/g)) {
    const t = m[1];
    if (!texts.has(t)) texts.set(t, []);
    texts.get(t).push(f.replace(".js", ""));
  }
}

const zhCN = JSON.parse(readFileSync("public/i18n/literals/zh-CN.json", "utf8"));
const zhTW = JSON.parse(readFileSync("public/i18n/literals/zh-TW.json", "utf8"));

const missingCN = [], missingTW = [], covered = [];
for (const [t, providers] of [...texts].sort()) {
  const hasCN = Object.prototype.hasOwnProperty.call(zhCN, t);
  const hasTW = Object.prototype.hasOwnProperty.call(zhTW, t);
  if (!hasCN) missingCN.push({ t, providers });
  if (!hasTW) missingTW.push({ t, providers });
  if (hasCN && hasTW) covered.push(t);
}
console.log(`registry notice texts: ${texts.size} | zh-CN 缺: ${missingCN.length} | zh-TW 缺: ${missingTW.length} | 全覆盖: ${covered.length}`);
writeFileSync("notice-missing.json", JSON.stringify(missingCN.map(({ t, providers }) => ({ provider: providers.join(","), text: t })), null, 2));
console.log("full list → notice-missing.json");
