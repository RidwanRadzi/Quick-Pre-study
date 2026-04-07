import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

const SUGGESTIONS = [
  "Rawang below 400k",
  "Cheras freehold",
  "Shah Alam below 600k",
  "Kepong apartment",
  "Cyberjaya serviced apartment",
  "Petaling Jaya below 800k",
];

interface SmartSuggestionsProps {
  onSelect: (text: string) => void;
}

export function SmartSuggestions({ onSelect }: SmartSuggestionsProps) {
  return (
    <div className="space-y-3 py-4">
      <p className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
        <Search className="h-4 w-4" />
        Try one of these searches
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {SUGGESTIONS.map((s) => (
          <Button
            key={s}
            variant="outline"
            size="sm"
            className="text-xs h-7 rounded-full border-border/60 hover:border-primary/50"
            onClick={() => onSelect(s)}
          >
            {s}
          </Button>
        ))}
      </div>
    </div>
  );
}
