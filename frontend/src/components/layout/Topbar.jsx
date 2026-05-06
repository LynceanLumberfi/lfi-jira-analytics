import { useLocation, Link } from "react-router-dom";
import { ChevronRight, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";

const CRUMBS = {
  "/integrations": ["Settings", "Integrations"],
  "/integrations/connect": ["Settings", "Integrations", "Connect Jira"],
  "/integrations/history": ["Settings", "Integrations", "Sync history"],
  "/integrations/failed": ["Settings", "Integrations", "Failed records"],
  "/analytics": ["Workspace", "Analytics", "Overview"],
};

function matchCrumbs(pathname) {
  if (CRUMBS[pathname]) return CRUMBS[pathname];
  if (pathname.startsWith("/integrations/sync/")) {
    return ["Settings", "Integrations", "Sync run"];
  }
  if (pathname.startsWith("/analytics/team/")) {
    return ["Workspace", "Analytics", "Team"];
  }
  return ["Settings", "Integrations"];
}

export function Topbar() {
  const { pathname } = useLocation();
  const crumbs = matchCrumbs(pathname);
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute("data-theme") || "light",
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-border bg-bg-elev/95 px-6 backdrop-blur">
      <nav className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={i} className="flex items-center gap-1.5">
              <span className={cn(last && "font-medium text-ink")}>{c}</span>
              {!last && <ChevronRight size={12} />}
            </span>
          );
        })}
      </nav>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="inline-flex h-8 w-8 items-center justify-center rounded text-ink-3 hover:bg-bg-sunken"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </header>
  );
}
