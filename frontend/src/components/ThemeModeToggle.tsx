import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/useTheme";
import { cn } from "@/lib/utils";

export function ThemeModeToggle({
  className,
  condensed = false,
}: {
  className?: string;
  condensed?: boolean;
}) {
  const { appearance, setAppearance } = useTheme();
  const isDark = appearance === "dark";

  const toggle = () => {
    setAppearance(isDark ? "light" : "dark");
  };

  return (
    <Button
      type="button"
      variant="outline"
      size={condensed ? "sm" : "default"}
      onClick={toggle}
      className={cn("gap-2", className)}
      aria-pressed={isDark}
    >
      {isDark ? (
        <>
          <Moon className="h-4 w-4" />
          <span>Dark</span>
        </>
      ) : (
        <>
          <Sun className="h-4 w-4" />
          <span>Light</span>
        </>
      )}
    </Button>
  );
}
