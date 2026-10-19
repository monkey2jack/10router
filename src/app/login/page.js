"use client";

import { useEffect, useState } from "react";
import { Card, Button, Input } from "@/shared/components";
import ThemeToggle from "@/shared/components/ThemeToggle";
import { translate } from "@/i18n/runtime";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // null = still loading. The two bootstrap states below are the only way this
  // page can be reached without a usable password, and neither is fixable from
  // here — so tell the operator what to do instead of looping "Invalid
  // password" (there is no default password any more; see
  // lib/auth/dashboardSession).
  const [status, setStatus] = useState(null);
  // "Forgot your password?" — the recovery route (issue #33): a locked-out
  // operator used to have no way back in short of reinstalling.
  const [showRecovery, setShowRecovery] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data) => setStatus(data || {}))
      .catch(() => setStatus({}));
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Invalid password");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const needsLocalSetup = status?.needsLocalSetup === true;
  const bootstrapLocal = status?.bootstrapLocal === true;
  // The hint below tells the operator where to open the dashboard on the host
  // machine. A hardcoded :20128 is wrong for anyone who moved the port or is
  // reached through a proxy, and the number they need is the one already in the
  // address bar — so derive it. Lazy initial state rather than an effect: this is
  // a one-shot read of an external value, and setState-in-effect would cascade an
  // extra render. Before hydration the documented default stands.
  const [localOrigin] = useState(() => {
    if (typeof window === "undefined") return "http://127.0.0.1:20128";
    const { protocol, hostname, port } = window.location;
    const p = port || (protocol === "https:" ? "443" : "80");
    return `${protocol}//${hostname}:${p}`;
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4 relative">
      {/* 主题三态切换（system/light/dark）：登录页默认跟随系统日/夜，白天不再黑屏 */}
      <div className="absolute top-6 right-6 z-20">
        <ThemeToggle variant="card" />
      </div>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary mb-2">10Router</h1>
          <p className="text-text-muted">Enter your password to access the dashboard</p>
        </div>

        <Card>
          {needsLocalSetup ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">No dashboard password is set yet</p>
              <p className="text-xs text-text-muted">
                Remote access to the dashboard stays disabled until a password is set. Set the first
                password on the machine running 10Router (open{" "}
                <code className="break-all font-mono text-text">{localOrigin}</code> there), or start
                it with the INITIAL_PASSWORD environment variable.
              </p>
            </div>
          ) : bootstrapLocal ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">No dashboard password is set yet</p>
              <p className="text-xs text-text-muted">
                Only this machine can open the dashboard until one is set. Set a password on the
                Settings page and LAN access turns back on.
              </p>
              <Button
                type="button"
                variant="primary"
                className="w-full"
                onClick={() => router.push("/dashboard")}
              >
                Open dashboard
              </Button>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Password</label>
                <Input
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
              </div>

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                isLoading={loading}
              >
                Login
              </Button>

              <button
                type="button"
                className="text-xs text-text-muted underline self-center hover:text-text"
                onClick={() => setShowRecovery((v) => !v)}
              >
                {translate("Forgot your password?")}
              </button>
              {showRecovery && (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3 text-xs text-text-muted">
                  {status?.installChannel === "fpk" && (
                    <p>{translate("fnOS: open App Center → 10Router → Settings, enter a new dashboard password and save. Sign in with it right away.")}</p>
                  )}
                  <p className="font-medium text-text">{translate("Recovery file format:")}</p>
                  <p>{translate("Name: reset-password — any extension works too (.txt, .md, …), since Windows makes extensionless files awkward. Content: plain UTF-8 text holding only the new password — a single line, no quotes, nothing else (leading/trailing whitespace is ignored).")}</p>
                  <p>{translate("An empty file removes the stored password and falls back to the first-login password (INITIAL_PASSWORD / fnOS initial-password).")}</p>
                  <p>{translate("Put it in the data folder — Windows: %APPDATA%\\10router · macOS / Linux: ~/.10router · Docker: the mounted DATA_DIR · fnOS: @appdata/10router on the app's volume. It applies on your next sign-in attempt (no restart) and is deleted the moment it is read.")}</p>
                  {status?.installChannel === "fpk" && status?.hasPassword === false && (
                    <p>{translate("First sign-in on fnOS: the generated password is in the initial-password file in that folder.")}</p>
                  )}
                  <p>
                    <a
                      href="https://github.com/techysy/10router/blob/main/docs/zh-CN/dashboard-password-recovery.md"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-text"
                    >
                      {translate("Full format reference (docs)")}
                    </a>
                  </p>
                </div>
              )}
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
