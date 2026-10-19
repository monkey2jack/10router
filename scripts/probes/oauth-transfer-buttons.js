(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el) => (el ? el.textContent.trim().replace(/\s+/g, " ") : null);
  const out = { steps: [] };

  // The transfer UI is gated behind the Experimental toggle; make sure it is ON
  // for the probe, and restore it after unless it was already on.
  const settings = await (await fetch("/api/settings")).json();
  const wasOn = settings.codeBuddyOAuthImport === true;
  if (!wasOn) {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codeBuddyOAuthImport: true }),
    });
    out.toggledForProbe = true;
  }

  const readButtons = () => {
    const pair = (re) =>
      [...document.querySelectorAll("button")]
        .map((b) => txt(b))
        .filter((t) => t && re.test(t));
    return {
      export: pair(/^(file_download)?\s*(Export|导出|匯出)/).length,
      import: pair(/^(upload_file)?\s*(Import|导入|匯入)/).length,
      labels: [...document.querySelectorAll("button")]
        .map((b) => txt(b))
        .filter((t) => /Export|Import|导出|导入|匯出|匯入/.test(t || ""))
        .map((t) => t.replace(/^(file_download|upload_file)\s*/, "")),
    };
  };

  const card = (name) =>
    [...document.querySelectorAll("h3")].find((h) => (h.textContent || "").trim() === name);

  out.steps.push({ url: location.href.replace(location.origin, ""), buttons: readButtons() });

  // Save the restore state for the next load via localStorage is not possible
  // cross-navigation from here; report instead.
  out.restoreToggle = !wasOn;
  return out;
})()
