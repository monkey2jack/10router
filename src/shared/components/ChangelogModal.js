"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { translate, getCurrentLocale } from "@/i18n/runtime";
import { GITHUB_CONFIG } from "@/shared/constants/config";
import { resolveChangelogCap, capChangelogByVersion } from "@/shared/utils/changelogCap";

let markedPromise = null;
// marked is only needed when the modal opens — load it on demand instead of
// taxing the initial bundle. Registered once per page load: the custom
// renderer cannot live at module scope anymore, it needs the lazy instance.
function loadMarked() {
  if (!markedPromise) {
    markedPromise = import("marked").then(({ marked }) => {
      marked.setOptions({ gfm: true, breaks: true });
      // External links (e.g. the full CHANGELOG.md link) must open in a new tab —
      // navigating inside the app window breaks the SPA. marked v18 passes a token
      // object {href, title, tokens} to the link renderer (NOT positional args);
      // use this.parser to render the link text so nested inline tokens survive.
      marked.use({
        link({ href, title, tokens }) {
          const text = tokens ? this.parser.parseInline(tokens) : (title || href);
          return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
        },
      });
      return marked;
    });
  }
  return markedPromise;
}

// Locales with a dedicated changelog translation. Everything else (including
// ja/ko until they're translated) falls back to en.md. The file name uses the
// canonical locale key exactly as the i18n literals (zh-CN, zh-TW).
const CHANGELOG_LOCALES = ["en", "zh-CN", "zh-TW"];

function changelogFileForLocale(locale) {
  const normalized = locale === "zh" ? "zh-CN" : locale;
  return CHANGELOG_LOCALES.includes(normalized) ? normalized : "en";
}

// Fetch with an AbortController timeout. Returns the response text, or throws.
function fetchWithTimeout(url, ms = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .finally(() => clearTimeout(timer));
}

// Try URLs in order until one succeeds. No retry delay.
function fetchChangelog(urls) {
  const [first, ...rest] = urls;
  if (!first) return Promise.reject(new Error("Failed to load changelog"));
  return fetchWithTimeout(first).catch(() => fetchChangelog(rest));
}

// Which versions may be rendered: /api/version reports the published npm release
// plus this build's own version. Fetched in parallel with the markdown so it
// costs no extra latency, and swallowed on failure (offline install, blocked
// registry) — losing the cap must never take the changelog down with it.
function fetchChangelogCap() {
  return fetchWithTimeout("/api/version")
    .then((r) => r.json())
    .then(resolveChangelogCap)
    .catch(() => null);
}

export default function ChangelogModal({ isOpen, onClose }) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // "Full CHANGELOG.md" opens INSIDE this modal. The desktop shell (fnOS
  // webview) cannot open target=_blank tabs, so the link used to do nothing
  // there; loading the raw file in place works everywhere.
  const [fullHtml, setFullHtml] = useState("");
  const [fullLoading, setFullLoading] = useState(false);
  const [fullError, setFullError] = useState("");
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen || html) return;
    setLoading(true);
    setError("");

    const file = changelogFileForLocale(getCurrentLocale());
    const urls = [
      `${GITHUB_CONFIG.changelogUrlBase}${file}.md`,                               // GitHub raw
      `${GITHUB_CONFIG.changelogUrlFallbackBase}${file}.md`,                       // Gitee raw
    ];
    const capPromise = fetchChangelogCap();
    // main carries the next release's notes before it ships; render only what
    // this client could actually have installed. See utils/changelogCap.js.
    const show = (md, cap) =>
      loadMarked().then((marked) => setHtml(marked.parse(capChangelogByVersion(md, cap))));

    Promise.all([fetchChangelog(urls), capPromise])
      .then(([md, cap]) => show(md, cap))
      .then(() => {
        setError("");
        setLoading(false);
      })
      .catch(() => {
        // Locale file missing (e.g. ja/ko not translated) or both sources
        // failed — fall back to English before surfacing an error.
        if (file !== "en") {
          const enUrls = [
            `${GITHUB_CONFIG.changelogUrlBase}en.md`,
            `${GITHUB_CONFIG.changelogUrlFallbackBase}en.md`,
          ];
          fetchChangelog(enUrls)
            .then((md) => capPromise.then((cap) => show(md, cap)))
            .then(() => setError("")).catch((enErr) => setError(enErr.message || "Failed to load"))
            .finally(() => setLoading(false));
        } else {
          setError("Failed to load");
          setLoading(false);
        }
      });
  }, [isOpen, html]);

  // Reload when the locale changes while the modal is open, so a locale switch
  // re-renders the changelog in the new language instead of reusing the cache.
  const currentLocale = getCurrentLocale();
  useEffect(() => {
    if (isOpen && html) setHtml("");
  }, [currentLocale]);

  const openFullChangelog = (e) => {
    e.preventDefault();
    setFullLoading(true);
    setFullError("");
    const urls = [
      `${GITHUB_CONFIG.changelogUrlBase.replace(/changelog\/$/, "")}CHANGELOG.md`,
      `${GITHUB_CONFIG.changelogUrlFallbackBase.replace(/changelog\/$/, "")}CHANGELOG.md`,
      "https://raw.githubusercontent.com/techysy/10router/refs/heads/main/CHANGELOG.md",
      "https://gitee.com/techysy/10router/raw/main/CHANGELOG.md",
    ];
    fetchChangelog(urls)
      .then((md) => loadMarked().then((marked) => setFullHtml(marked.parse(md))))
      .catch((err) => setFullError(err?.message || "Failed to load"))
      .finally(() => setFullLoading(false));
  };

  // Delegated click handler for the rendered markdown: only the CHANGELOG.md
  // link is intercepted, every other link keeps its normal behaviour.
  const handleBodyClick = (e) => {
    const a = e.target?.closest?.("a");
    if (!a) return;
    if (!/CHANGELOG\.md(\?|#|$)/.test(a.getAttribute("href") || "")) return;
    openFullChangelog(e);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        setFullHtml("");
        setFullError("");
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  // Reset the in-app full view on close so the next open starts at the
  // release notes, not on the 5000-line CHANGELOG.
  const handleClose = () => {
    setFullHtml("");
    setFullError("");
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal content */}
      <div
        ref={modalRef}
        className="relative w-full bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-w-3xl flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-black/5 dark:border-white/5">
          <div className="flex min-w-0 items-center gap-2">
            {fullHtml && (
              <button
                onClick={() => setFullHtml("")}
                className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                aria-label={translate("Back")}
                title={translate("Back")}
              >
                <span className="material-symbols-outlined text-[20px]">arrow_back</span>
              </button>
            )}
            <h2 className="truncate text-lg font-semibold text-text-main">
              {fullHtml ? "CHANGELOG.md" : translate("Change Log")}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-text-muted hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label={translate("Close")}
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {loading && (
            <div className="flex items-center justify-center py-10 text-text-muted">
              <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
              {translate("Loading...")}
            </div>
          )}
          {error && (
            <div className="text-red-500 py-4">{translate("Failed to load changelog: ")}{error}</div>
          )}
          {!loading && !error && html && !fullHtml && (
            <div
              className="changelog-body text-text-main"
              onClick={handleBodyClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
          {fullLoading && (
            <div className="flex items-center justify-center py-10 text-text-muted">
              <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
              {translate("Loading...")}
            </div>
          )}
          {fullError && (
            <div className="text-red-500 py-4">{translate("Failed to load changelog: ")}{fullError}</div>
          )}
          {!fullLoading && !fullError && fullHtml && (
            <div className="changelog-body text-text-main" dangerouslySetInnerHTML={{ __html: fullHtml }} />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

ChangelogModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
