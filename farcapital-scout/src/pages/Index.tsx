import { Link } from "react-router-dom";
import { LayoutList, Search } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChatInterface } from "@/components/ChatInterface";
import { Button } from "@/components/ui/button";

export default function Index() {
  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Nav */}
      <header className="shrink-0 border-b border-border/60 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm tracking-tight">FarCapital Scout</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">— Malaysian Property Intelligence</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild className="text-xs gap-1.5">
            <Link to="/tracker">
              <LayoutList className="h-4 w-4" />
              Tracker
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {/* Chat fills remaining height */}
      <main className="flex-1 min-h-0">
        <ChatInterface />
      </main>
    </div>
  );
}
