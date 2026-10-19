// electron-builder afterPack hook: ad-hoc sign the macOS .app when there is no
// Apple certificate (CI: .github/workflows/build-desktop-mac.yml passes it with
// -c.afterPack=build/adhoc-sign.js).
//
// electron-builder 25 does not fall back to ad-hoc on its own — with no identity
// it skips signing, and identity "-" is taken as a certificate name and skipped
// too. The repackaged Electron bundle then carries a broken signature, which a
// downloaded copy reports as "damaged" with no right-click → Open escape. An
// ad-hoc signature turns that into the normal "unidentified developer" prompt.
//
// afterPack runs once per arch, after the .app is assembled and before the dmg
// is built; electron-builder's own (skipped) signing step leaves it alone.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing  app=${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
};
