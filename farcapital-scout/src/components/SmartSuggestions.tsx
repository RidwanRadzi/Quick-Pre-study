import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

// Default searches — serviced apartment + condo focus
const DEFAULT_SUGGESTIONS = [
  "Rawang below 400k",
  "Cheras below 600k",
  "Shah Alam freehold",
  "Kepong below 500k",
  "Cyberjaya below 450k",
  "Petaling Jaya below 800k",
];

// Type-specific overrides user can tap
const TYPE_FILTERS = [
  { label: "Serviced Apt", value: "serviced apartment" },
  { label: "Condominium", value: "condominium" },
  { label: "Apartment", value: "apartment" },
  { label: "Townhouse", value: "townhouse" },
  { label: "SOHO / SOVO", value: "soho" },
];

interface SmartSuggestionsProps {
  onSelect: (text: string) => void;
}

export function SmartSuggestions({ onSelect }: SmartSuggestionsProps) {
  return (
    <div className="space-y-4 py-4">
      <p className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
        <Search className="h-4 w-4" />
        Search by location — defaults to Serviced Apt &amp; Condo
      </p>

      {/* Location suggestions */}
      <div className="flex flex-wrap gap-2 justify-center">
        {DEFAULT_SUGGESTIONS.map((s) => (
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

      {/* Property type filters */}
      <div className="flex flex-wrap gap-2 justify-center items-center">
        <span className="text-[11px] text-muted-foreground">Filter by type:</span>
        {TYPE_FILTERS.map((t) => (
          <Button
            key={t.value}
            variant="secondary"
            size="sm"
            className="text-xs h-6 rounded-full px-2.5"
            onClick={() => onSelect(`Rawang ${t.value}`)}
          >
            {t.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
