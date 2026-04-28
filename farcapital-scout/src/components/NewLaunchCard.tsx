import { ExternalLink, Building2, CalendarCheck, Ruler, Tag, Landmark } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NewLaunchProject } from "@/types/property";

interface NewLaunchCardProps {
  launch: NewLaunchProject;
}

function formatRM(val: number): string {
  if (val >= 1_000_000) return `RM ${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `RM ${(val / 1_000).toFixed(0)}k`;
  return `RM ${val}`;
}

function tenureColor(tenure: string | null) {
  if (!tenure) return "bg-muted text-muted-foreground border-border/50";
  if (tenure.toLowerCase().includes("freehold")) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  return "bg-blue-500/15 text-blue-400 border-blue-500/30";
}

function typeColor(type: string) {
  if (type === "Condominium") return "bg-violet-500/15 text-violet-400 border-violet-500/30";
  if (type === "Serviced Apartment") return "bg-primary/15 text-primary border-primary/30";
  if (type === "SOHO") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (type === "Townhouse") return "bg-orange-500/15 text-orange-400 border-orange-500/30";
  return "bg-muted text-muted-foreground border-border/50";
}

export function NewLaunchCard({ launch }: NewLaunchCardProps) {
  const {
    project_name, developer, area, state,
    price_from, price_to, property_type,
    unit_sizes, expected_vp, source_url,
    tenure, snippet,
  } = launch;

  const priceLabel =
    price_from && price_to
      ? `${formatRM(price_from)} – ${formatRM(price_to)}`
      : price_from
      ? `From ${formatRM(price_from)}`
      : "Price TBA";

  return (
    <Card className="flex flex-col border-border/60 bg-card/80 backdrop-blur-sm hover:border-amber-400/40 transition-colors">
      <CardContent className="pt-5 pb-3 flex-1 space-y-3">

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-tight truncate">{project_name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {area}{state && state !== area ? `, ${state}` : ""}
            </p>
          </div>
          {/* NEW LAUNCH badge */}
          <Badge className="border text-[10px] font-bold bg-amber-500/15 text-amber-400 border-amber-500/30 shrink-0" variant="outline">
            New Launch
          </Badge>
        </div>

        {/* Developer */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Landmark className="h-3 w-3 shrink-0" />
          <span className="font-medium text-foreground truncate">{developer}</span>
        </div>

        {/* Price range */}
        <div className="rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 flex items-center justify-between text-xs">
          <span className="text-amber-400 font-medium flex items-center gap-1">
            <Tag className="h-3 w-3" />
            {priceLabel}
          </span>
        </div>

        {/* Property type + tenure badges */}
        <div className="flex flex-wrap gap-1.5">
          <span className={cn("text-[10px] px-2 py-0.5 rounded border leading-none", typeColor(property_type))}>
            {property_type}
          </span>
          {tenure && (
            <span className={cn("text-[10px] px-2 py-0.5 rounded border leading-none", tenureColor(tenure))}>
              {tenure}
            </span>
          )}
        </div>

        {/* Unit sizes + expected VP */}
        <div className="rounded-md bg-muted/40 px-3 py-2 grid grid-cols-2 gap-2 text-xs">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Ruler className="h-3 w-3" />
              <span>Unit Size</span>
            </div>
            <span className="font-medium">{unit_sizes ?? "—"}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 text-muted-foreground">
              <CalendarCheck className="h-3 w-3" />
              <span>Expected VP</span>
            </div>
            <span className="font-medium">{expected_vp ?? "TBA"}</span>
          </div>
        </div>

        {/* Snippet */}
        {snippet && (
          <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{snippet}</p>
        )}
      </CardContent>

      <CardFooter className="gap-2 pt-0 pb-4">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs h-8 border-amber-500/30 hover:border-amber-400/60 hover:text-amber-400"
          disabled={!source_url}
          onClick={() => source_url && window.open(source_url, "_blank")}
        >
          <ExternalLink className="h-3 w-3" />
          {source_url ? "View Project" : "No Link"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs h-8"
          onClick={() => {
            const query = encodeURIComponent(`${project_name} ${area}`);
            window.open(`https://www.propertyguru.com.my/property-for-sale?search_type=keyword&q=${query}`, "_blank");
          }}
        >
          <Building2 className="h-3 w-3" />
          Search PG
        </Button>
      </CardFooter>
    </Card>
  );
}
