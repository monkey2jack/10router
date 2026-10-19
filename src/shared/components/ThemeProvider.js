"use client";

import { useEffect } from "react";
import useThemeStore from "@/store/themeStore";

export function ThemeProvider({ children }) {
  const { initTheme } = useThemeStore();

  useEffect(() => {
    initTheme();
    // Follow the OS while the preference is "system" — this is the layer that
    // makes pages WITHOUT a useTheme() consumer (login, error pages) switch
    // live when Windows personalization / macOS appearance / the fnOS browser
    // changes day/night. Components that call useTheme() subscribe separately.
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (useThemeStore.getState().theme === "system") initTheme();
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [initTheme]);

  return <>{children}</>;
}
