export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Start the app with the server, not on the first page render. bootstrap
    // used to be reached only through the root layout, so after a restart the
    // tunnel / Tailscale / MITM auto-resume, the watchdog and the usage cost
    // repair all waited until someone opened a dashboard page (NAS 2026-09-26:
    // restart 09:35, startup ran at 10:23). A gateway that is only ever called
    // on /v1 never got there at all. Importing it here is fire-and-forget —
    // initializeApp defers its heavy work — and the global.__appBootstrapped
    // guard keeps the layout's import from starting it twice.
    await import("@/shared/services/bootstrap");
  }
}
