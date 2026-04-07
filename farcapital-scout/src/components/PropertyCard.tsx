import { ExternalLink, TrendingUp, Building2, BarChart3, BookmarkPlus, CalendarCheck, Home } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatPSF, urgencyBadge, buildQpsUrl } from "@/lib/utils";
import type { PropertyProject } from "@/types/property";

interface PropertyCardProps {
  project: PropertyProject;
  onSave?: (project: PropertyProject) => void;
  saving?: boolean;
}

const QPS_URL = import.meta.env.VITE_QPS_URL || "https://quick-pre-study.vercel.app";

export function PropertyCard({ project, onSave, saving }: PropertyCardProps) {
  const { project_name, area, state, listing_count, financials, completion_year, total_units } = project;
  const { median_psf, gross_yield, urgency_score } = financials;

  const urgencyClass = urgencyBadge(urgency_score);

  return (
    <Card className="flex flex-col border-border/60 bg-card/80 backdrop-blur-sm hover:border-primary/40 transition-colors">
      <CardContent className="pt-5 pb-3 flex-1 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-tight truncate">{project_name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {area}{state && state !== area ? `, ${state}` : ""}
            </p>
          </div>
          <Badge
            className={cn("shrink-0 border text-xs font-bold", urgencyClass)}
            variant="outline"
          >
            {urgency_score}/100
          </Badge>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-3 gap-3">
          <Metric
            icon={<BarChart3 className="h-3 w-3" />}
            label="Median PSF"
            value={formatPSF(median_psf)}
          />
          <Metric
            icon={<TrendingUp className="h-3 w-3" />}
            label="Gross Yield"
            value={`${gross_yield.toFixed(1)}%`}
            highlight={gross_yield >= 5}
          />
          <Metric
            icon={<Building2 className="h-3 w-3" />}
            label="Listings"
            value={String(listing_count)}
          />
        </div>

        {/* Completion year + total units row */}
        <div className="rounded-md bg-muted/40 px-3 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarCheck className="h-3 w-3" />
            <span>Completion</span>
          </div>
          <span className="font-medium">{completion_year ?? "—"}</span>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Home className="h-3 w-3" />
            <span>Total Units</span>
          </div>
          <span className="font-medium">{total_units ? total_units.toLocaleString() : "—"}</span>
        </div>
      </CardContent>

      <CardFooter className="gap-2 pt-0 pb-4">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs h-8"
          onClick={() => window.open(buildQpsUrl(QPS_URL, { name: project_name, area, state }), "_blank")}
        >
          <ExternalLink className="h-3 w-3" />
          Open in QPS
        </Button>
        {onSave && (
          <Button
            variant="default"
            size="sm"
            className="flex-1 text-xs h-8"
            disabled={saving}
            onClick={() => onSave(project)}
          >
            <BookmarkPlus className="h-3 w-3" />
            {saving ? "Saving…" : "Track"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function Metric({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <span className={cn("text-sm font-semibold", highlight && "text-primary")}>{value}</span>
    </div>
  );
}
