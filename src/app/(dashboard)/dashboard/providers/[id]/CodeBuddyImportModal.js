"use client";

import { useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";

// Hidden long-press entry: import CodeBuddy CN accounts from a JSON export
// (account-switcher / CLI token dump). Pairs are merged into codebuddy-cn by
// identity (same Keycloak sub → update; otherwise create).

export default function CodeBuddyImportModal({ isOpen, onClose, onSuccess, password = "" }) {
  const [jsonText, setJsonText] = useState("");
  const [fileName, setFileName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const handleClose = () => {
    if (submitting) return;
    setJsonText("");
    setFileName("");
    setParseError("");
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
    onClose();
  };

  const onFilePicked = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    setResult(null);
    const reader = new FileReader();
    reader.onload = () => setJsonText(String(reader.result || ""));
    reader.onerror = () => setParseError(translate("Failed to read file"));
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    setParseError("");
    setResult(null);

    const trimmed = jsonText.trim();
    if (!trimmed) return;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      setParseError(`${translate("Invalid JSON")}: ${err.message}`);
      return;
    }

    // Accept array / { accounts: [...] } / single object — backend normalizes too.
    const accounts = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
      ? Array.isArray(parsed.accounts)
        ? parsed.accounts
        : [parsed]
      : null;
    if (!accounts || accounts.length === 0) {
      setParseError(translate("No accounts found in input"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/oauth/codebuddy-cn/bulk-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(password ? { "x-10r-password": password } : {}),
        },
        body: JSON.stringify({ accounts }),
      });
      const data = await res.json();
      if (!res.ok) {
        setParseError(
          res.status === 401
            ? translate("Invalid password")
            : data?.error || `Request failed: ${res.status}`
        );
        return;
      }
      setResult(data);
      if ((data.imported > 0 || data.updated > 0) && typeof onSuccess === "function") {
        onSuccess();
      }
    } catch (err) {
      setParseError(err.message || translate("Request failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const failedItems = result?.results?.filter((r) => !r.ok) || [];
  const skippedCount = result?.skipped ?? 0;

  return (
    <Modal isOpen={isOpen} title={translate("Import CodeBuddy CN Accounts")} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Button
            variant="secondary"
            fullWidth
            icon="upload_file"
            onClick={() => fileRef.current?.click()}
            disabled={submitting}
          >
            {fileName ? fileName : translate("Choose JSON file...")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={onFilePicked}
          />
        </div>

        <div className="relative">
          <div className="absolute -top-2 left-2 bg-sidebar px-1 text-[10px] text-text-muted">
            {translate("Or paste JSON")}
          </div>
          <textarea
            className="w-full rounded border border-accent/30 bg-sidebar p-2 pt-4 text-sm font-mono resize-y min-h-[160px] focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder='[{ "access_token": "eyJ...", "refresh_token": "eyJ...", "nickname": "<nickname>" }]'
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            disabled={submitting}
          />
        </div>

        {parseError && <p className="text-xs text-red-500 break-words">{parseError}</p>}

        {result && (
          <div className="flex flex-col gap-2">
            <div
              className={`text-sm font-medium ${
                result.failed > 0 ? "text-yellow-400" : "text-green-400"
              }`}
            >
              ✓ {result.imported} {translate("added")}, {result.updated} {translate("updated")}
              {skippedCount > 0 ? `, ${skippedCount} ${translate("skipped")}` : ""}
              {result.failed > 0 ? `, ✗ ${result.failed} ${translate("failed")}` : ""}
            </div>
            {failedItems.length > 0 && (
              <ul className="rounded border border-accent/20 bg-sidebar/50 p-2 text-xs font-mono max-h-40 overflow-y-auto">
                {failedItems.map((item) => (
                  <li key={item.index} className="text-red-400">
                    [{item.index}] {item.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            fullWidth
            disabled={submitting || !jsonText.trim()}
          >
            {submitting ? translate("Importing...") : translate("Import All")}
          </Button>
          <Button onClick={handleClose} variant="ghost" fullWidth disabled={submitting}>
            {translate("Close")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

CodeBuddyImportModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
  password: PropTypes.string,
};
