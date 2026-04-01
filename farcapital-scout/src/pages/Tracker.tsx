import { Link } from "react-router-dom";
import { ArrowLeft, Search } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AcquisitionTracker } from "@/components/AcquisitionTracker";
import { Button } from "@/components/ui/button";

export default function Tracker() {
  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Nav */}
      <header className="shrink-0 border-b border-border/60 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm tracking-tight">FarCapital Scout</span>
          <span className="text-muted-foreground text-xs hidden sm:inline">— Acquisition Tracker</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild className="text-xs gap-1.5">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
              Scout
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 overflow-auto px-4 py-6 max-w-6xl mx-auto w-full">
        <div className="space-y-1 mb-6">
          <h1 className="text-lg font-semibold">Acquisition Tracker</h1>
          <p className="text-sm text-muted-foreground">
            Track projects through your acquisition pipeline. Click "Track" on any search result to add it here.
          </p>
        </div>
        <AcquisitionTracker />
      </main>
    </div>
  );
}
