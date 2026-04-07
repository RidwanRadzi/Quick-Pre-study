import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

const SUGGESTIONS = [
  "VP unit Rawang condo below 400k",
  "OC stage serviced apartment Kepong freehold",
  "projek siap developer unit Cheras below 600k",
  "unsold VP condo Petaling Jaya below 800k",
  "near completion SOHO Cyberjaya below 450k",
  "developer unit vacant possession Shah Alam",
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
