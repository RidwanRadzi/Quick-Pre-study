import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const PROPERTY_TYPES = [
  { label: "Serviced Apt", value: "serviced apartment" },
  { label: "Condominium",  value: "condominium" },
  { label: "Apartment",    value: "apartment" },
  { label: "Townhouse",    value: "townhouse" },
  { label: "SOHO / SOVO",  value: "soho" },
];

const LOCATION_CHIPS = [
  "Rawang", "Cheras", "Kepong", "Shah Alam",
  "Cyberjaya", "Petaling Jaya", "Subang Jaya", "Kajang",
];

interface SmartSuggestionsProps {
  selectedType: string;
  onTypeSelect: (type: string) => void;
  onLocationSelect: (location: string) => void;
}

export function SmartSuggestions({ selectedType, onTypeSelect, onLocationSelect }: SmartSuggestionsProps) {
  return (
    <div className="space-y-5 py-2 w-full max-w-lg mx-auto">

      {/* Step 1 — pick type */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground text-center uppercase tracking-wide font-medium">
          1 · Pick property type
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          {PROPERTY_TYPES.map((t) => (
            <Button
              key={t.value}
              variant={selectedType === t.value ? "default" : "outline"}
              size="sm"
              className={cn(
                "text-xs h-8 rounded-full px-3",
                selectedType === t.value && "ring-2 ring-primary/50"
              )}
              onClick={() => onTypeSelect(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Step 2 — pick location */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground text-center uppercase tracking-wide font-medium">
          2 · Type or pick a location
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          {LOCATION_CHIPS.map((loc) => (
            <Button
              key={loc}
              variant="outline"
              size="sm"
              className="text-xs h-7 rounded-full border-border/60 hover:border-primary/50"
              onClick={() => onLocationSelect(loc)}
            >
              {loc}
            </Button>
          ))}
        </div>
      </div>

    </div>
  );
}
