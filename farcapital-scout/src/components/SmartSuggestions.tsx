import { Building2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";

const LOCATION_SUGGESTIONS = [
  { label: "Rawang", query: "projek siap VP developer unit Rawang below 400k" },
  { label: "Cheras", query: "condo siap OC developer unit Cheras below 600k" },
  { label: "Kepong", query: "serviced apartment VP developer unit Kepong below 500k" },
  { label: "Shah Alam", query: "developer unit siap VP Shah Alam below 550k" },
  { label: "Cyberjaya", query: "condo completing 2025 OC developer unit Cyberjaya below 500k" },
  { label: "Petaling Jaya", query: "serviced apartment VP developer unit Petaling Jaya below 700k" },
];

const TYPE_SUGGESTIONS = [
  { label: "Serviced Apt", query: "serviced apartment siap VP developer unit Selangor below 600k" },
  { label: "Condominium",  query: "condominium siap VP developer unit Selangor below 700k" },
  { label: "SOHO / SOVO",  query: "SOHO SOVO siap VP developer unit KL below 500k" },
  { label: "Townhouse",    query: "townhouse siap VP developer unit Selangor below 800k" },
];

interface SmartSuggestionsProps {
  onSelect: (text: string) => void;
}

export function SmartSuggestions({ onSelect }: SmartSuggestionsProps) {
  return (
    <div className="space-y-5 py-2 w-full max-w-lg">

      {/* By location */}
      <div className="space-y-2">
        <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          Search by location
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          {LOCATION_SUGGESTIONS.map((s) => (
            <Button
              key={s.label}
              variant="outline"
              size="sm"
              className="text-xs h-7 rounded-full border-border/60 hover:border-primary/50"
              onClick={() => onSelect(s.query)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      {/* By property type */}
      <div className="space-y-2">
        <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          Search by property type
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          {TYPE_SUGGESTIONS.map((s) => (
            <Button
              key={s.label}
              variant="outline"
              size="sm"
              className="text-xs h-7 rounded-full border-border/60 hover:border-primary/50"
              onClick={() => onSelect(s.query)}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-center text-[11px] text-muted-foreground/60">
        Scout searches for VP / OC completed developer units only — no subsale, no auction.
      </p>
    </div>
  );
}
