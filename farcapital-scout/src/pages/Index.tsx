import { useState } from "react";
import { Link } from "react-router-dom";
import { LayoutList, Search, Rocket } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChatInterface } from "@/components/ChatInterface";
import { NewLaunchInterface } from "@/components/NewLaunchInterface";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Tab = "scout" | "new-launches";

export default function Index() {
  const [tab, setTab] = useState<Tab>("scout");

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Nav */}
      <header className="shrink-0 border-b border-border/60 px-4 py-2.5 flex items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2 shrink-0">
          <Search className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm tracking-tight">FarCapital Scout</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">— Malaysian Property Intelligence</span>
        </div>

        {/* Tabs — centre */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
          <button
            onClick={() => setTab("scout")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              tab === "scout"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Search className="h-3.5 w-3.5" />
            Scout
            <span className="text-[10px] text-muted-foreground font-normal hidden sm:inline">VP / OC</span>
          </button>
          <button
            onClick={() => setTab("new-launches")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              tab === "new-launches"
                ? "bg-background text-amber-400 shadow-sm"
                : "text-muted-foreground hover:text-amber-400"
            )}
          >
            <Rocket className="h-3.5 w-3.5" />
            New Launches
          </button>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" asChild className="text-xs gap-1.5">
            <Link to="/tracker">
              <LayoutList className="h-4 w-4" />
              Tracker
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 min-h-0">
        {tab === "scout" ? <ChatInterface /> : <NewLaunchInterface />}
      </main>
    </div>
  );
}
