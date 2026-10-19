"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { THEME_CONFIG } from "@/shared/constants/config";

const useThemeStore = create(
  persist(
    (set, get) => ({
      theme: THEME_CONFIG.defaultTheme,

      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },

      // Three-state cycle: system → light → dark → system. "system" follows the
      // OS preference (Windows personalization / macOS appearance / the fnOS
      // browser), so a machine that switches day/night on its own keeps the UI
      // in sync without a manual toggle.
      toggleTheme: () => {
        const currentTheme = get().theme;
        const nextTheme =
          currentTheme === "system" ? "light" : currentTheme === "light" ? "dark" : "system";
        set({ theme: nextTheme });
        applyTheme(nextTheme);
      },

      initTheme: () => {
        const theme = get().theme;
        applyTheme(theme);
      },
    }),
    {
      name: THEME_CONFIG.storageKey,
    }
  )
);

// Apply theme to document
function applyTheme(theme) {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";

  const effectiveTheme = theme === "system" ? systemTheme : theme;

  if (effectiveTheme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export default useThemeStore;

