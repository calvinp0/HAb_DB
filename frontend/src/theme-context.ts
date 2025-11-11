import { createContext } from "react";
export type Appearance = "light" | "dark";

export type ThemeContextValue = {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
};

export const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined,
);
