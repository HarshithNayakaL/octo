import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ThemeChoice = "system" | "light" | "dark";
const ThemeContext = createContext<{
  choice: ThemeChoice;
  resolved: "light" | "dark";
  setChoice: (choice: ThemeChoice) => void;
}>({ choice: "system", resolved: "light", setChoice: () => undefined });

const stored = (): ThemeChoice => {
  try {
    const value = localStorage.getItem("octo-theme");
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
};
const systemDark = () =>
  typeof matchMedia !== "undefined" &&
  matchMedia("(prefers-color-scheme: dark)").matches;

/** Light, dark, or following the operating system; remembered per browser. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(stored);
  const [system, setSystem] = useState(systemDark);
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystem(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const resolved = choice === "system" ? (system ? "dark" : "light") : choice;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolved === "dark" ? "#0d1017" : "#002fa7");
  }, [resolved]);
  const setChoice = (next: ThemeChoice) => {
    setChoiceState(next);
    try {
      if (next === "system") localStorage.removeItem("octo-theme");
      else localStorage.setItem("octo-theme", next);
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
  };
  return (
    <ThemeContext.Provider value={{ choice, resolved, setChoice }}>
      {children}
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
