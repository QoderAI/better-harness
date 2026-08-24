import { createContext, useContext } from "react";

export type StudioTheme = "dark" | "light";

export const StudioThemeContext = createContext<StudioTheme>("dark");

export function useStudioTheme(): StudioTheme {
  return useContext(StudioThemeContext);
}
