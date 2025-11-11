import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  ThemeContext,
  type ThemeContextValue,
  type Appearance,
} from "./theme-context";

const APPEARANCE_KEY = "habdb.appearance";

const getInitialAppearance = (): Appearance => {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(APPEARANCE_KEY) as Appearance | null;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

const initialAppearance = getInitialAppearance();

if (typeof document !== "undefined") {
  document.documentElement.classList.toggle("dark", initialAppearance === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [appearanceState, setAppearanceState] =
    useState<Appearance>(initialAppearance);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("dark", appearanceState === "dark");
    if (typeof window !== "undefined") {
      window.localStorage.setItem(APPEARANCE_KEY, appearanceState);
    }
  }, [appearanceState]);

  const setAppearance = useCallback(
    (appearance: Appearance) => {
      setAppearanceState(appearance);
    },
    [setAppearanceState],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      appearance: appearanceState,
      setAppearance,
    }),
    [appearanceState, setAppearance],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
