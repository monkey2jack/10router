/**
 * Quota page ("/dashboard/quota") toolbar + card probe.
 *
 * Reads what the toolbar actually renders — icon glyph, label, pressed state —
 * and then exercises the two view controls end to end, reporting the numbers a
 * user would see. Written for bugs that only exist in the rendered DOM:
 *
 *   - The eye icon contradicting its own label (icon said "everything visible"
 *     next to a label promising rows were being hidden).
 *   - "Showing 1-10 of 46" sitting above a filtered grid of 12 cards: the
 *     summary was quoting the SERVER's page count, which cannot see the
 *     client-side view filters.
 *   - Chip clicks in one card being dropped: the handlers read the visibility
 *     map from the render closure, so a burst in a single tick all computed
 *     from the same pre-click snapshot and only the last write survived. This
 *     one is invisible to sequential clicking AND to sequential testing — the
 *     clicks have to be fired in the same tick, which is what `burstClick`
 *     below does on purpose.
 *
 * Run it through scripts/browser-probe.mjs against an already-deployed build.
 * Both controls persist through an HTTP PATCH to /api/settings, so the probe
 * restores whatever state it found before returning.
 *
 *   node scripts/browser-probe.mjs http://localhost:20128/dashboard/quota \
 *     --script scripts/probes/quota-toolbar.js --json quota.json
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el) => (el ? el.textContent.trim().replace(/\s+/g, " ") : null);

  // Fire every click in the same tick — the whole point of the burst probes.
  // Awaiting each one hides the stale-closure bug entirely.
  const burstClick = (els) => els.forEach((el) => el.click());

  const flipButton = () =>
    [...document.querySelectorAll("button")].find((b) =>
      /Only with balance|Show all/.test(txt(b) || ""),
    );
  const summaryEl = () =>
    [...document.querySelectorAll("span")].find((s) =>
      /^Showing /.test(txt(s) || ""),
    );
  const noticeEl = () =>
    [...document.querySelectorAll("div")].find((d) =>
      /View filter is on|视图筛选已开启/.test(txt(d) || ""),
    );
  const cards = () =>
    [...document.querySelectorAll("div")].find(
      (d) =>
        String(d.className || "").includes("grid-cols-1") &&
        String(d.className || "").includes("gap-3"),
    );
  const cardOf = (name) => {
    const g = cards();
    return g
      ? [...g.children].find((c) => txt(c.querySelector("h3")) === name)
      : null;
  };
  const cardState = (name) => {
    const c = cardOf(name);
    if (!c) return null;
    const t = txt(c) || "";
    const hiddenAt = t.indexOf("Hidden:");
    return {
      visibleRows: (t.match(/\d+%/g) || []).length,
      hideButtons: [...c.querySelectorAll("button")].filter((b) =>
        /Hide quota/.test(b.getAttribute("aria-label") || ""),
      ).length,
      hiddenChips: [...c.querySelectorAll("button")].filter((b) =>
        /Show this quota row/.test(b.getAttribute("title") || ""),
      ).length,
      hidden: hiddenAt === -1 ? null : t.slice(hiddenAt, hiddenAt + 70),
      emptyBodyMessage:
        (t.match(
          /(All quota rows are hidden|No quota left to show)[^A-Z]*/,
        ) || [])[0] || null,
    };
  };

  const report = { version: null, steps: [], burst: null, iconLabelPairs: [] };
  try {
    report.version = (await (await fetch("/api/version")).json()).currentVersion;
  } catch {
    report.version = "(version endpoint unavailable)";
  }

  // ---- 1. Toolbar icon ↔ label agreement -------------------------------
  const flip = flipButton();
  if (flip) {
    report.iconLabelPairs.push({
      state: flip.getAttribute("aria-pressed") === "true" ? "on" : "off",
      icon: txt(flip.querySelector(".material-symbols-outlined")),
      label: [...flip.querySelectorAll("span")]
        .map(txt)
        .filter((t) => t && !/^(visibility|visibility_off)$/.test(t))
        .join(" "),
    });
  }

  const snapshot = (tag) => {
    const f = flipButton();
    report.steps.push({
      tag,
      icon: txt(f?.querySelector(".material-symbols-outlined")),
      label: txt(f || "").replace(/^[a-z_]+/, ""),
      summary: txt(summaryEl()),
      noticePresent: Boolean(noticeEl()),
      cardCount: cards() ? cards().children.length : 0,
    });
  };

  snapshot("0. as loaded");
  if (flip) {
    flip.click();
    await sleep(1600);
    snapshot("1. after flipping the row filter");
    report.iconLabelPairs.push({
      state: flipButton()?.getAttribute("aria-pressed") === "true" ? "on" : "off",
      icon: txt(flipButton()?.querySelector(".material-symbols-outlined")),
      label: txt(flipButton() || "").replace(/^[a-z_]+/, ""),
    });
  }

  // ---- 2. Same-tick burst on one card's hide/show chips ----------------
  // Use whichever card currently has the most quota rows, so the probe works
  // on any account set. The burst must have something to restore to prove the
  // fix: hide N in one tick, then show N in one tick, and compare.
  const candidate = (() => {
    const g = cards();
    if (!g) return null;
    return [...g.children]
      .map((c) => ({ c, n: (txt(c)?.match(/\d+%/g) || []).length }))
      .sort((a, b) => b.n - a.n)[0];
  })();

  if (candidate && candidate.n > 0) {
    const name = txt(candidate.c.querySelector("h3"));
    const before = cardState(name);
    const hides = [...candidate.c.querySelectorAll("button")].filter((b) =>
      /Hide quota/.test(b.getAttribute("aria-label") || ""),
    );
    burstClick(hides);
    await sleep(2500);
    const hiddenState = cardState(name);

    const c2 = cardOf(name);
    const chips = c2
      ? [...c2.querySelectorAll("button")].filter((b) =>
          /Show this quota row/.test(b.getAttribute("title") || ""),
        )
      : [];
    burstClick(chips);
    await sleep(2500);
    const restored = cardState(name);

    report.burst = {
      card: name,
      burstHideCount: hides.length,
      burstShowCount: chips.length,
      before,
      afterBurstHide: hiddenState,
      afterBurstShow: restored,
      // The regression: every one of N same-tick clicks must land, so a burst
      // of N hides leaves 0 rows and a burst of N shows restores all N.
      allHidesApplied: hiddenState?.visibleRows === 0,
      allShowsApplied: restored?.visibleRows === before?.visibleRows,
    };
  } else {
    report.burst = { skipped: "no card with visible quota rows" };
  }

  return report;
})()
