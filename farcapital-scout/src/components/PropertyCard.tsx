import { ExternalLink, BarChart3, BookmarkPlus, CalendarCheck, Home, Clock, TrendingUp, ArrowLeftRight, AlertCircle, CheckCircle2 } from "lucide-react";
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

const SOURCE_LABELS: Record<string, string> = {
  "propertyguru.com.my": "PropertyGuru",
  "iproperty.com.my": "iProperty",
  "edgeprop.my": "EdgeProp",
  "developer": "Developer",
};

function formatLastSeen(date: string | null): string {
  if (!date) return "—";
  if (/\b(ago|day|week|month|hour|minute)\b/i.test(date)) return date;
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-MY", { month: "short", year: "numeric" });
}

const AVAILABILITY_CONFIG = {
  high:   { label: "High Availability",   className: "bg-green-500/15 text-green-400 border-green-500/30" },
  medium: { label: "Medium Availability", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  low:    { label: "Low Availability",    className: "bg-red-500/15 text-red-400 border-red-500/30" },
};

export function PropertyCard({ project, onSave, saving }: PropertyCardProps) {
  const {
    project_name, area, state, financials, completion_year, year_verified, total_units,
    best_listing_url, best_source, psf_confidence, psf_source_count,
    last_seen, availability, availability_pct, scraped_developer, scraped_status,
    transaction_psf_low, transaction_psf_high, transaction_count,
  } = project;
  const { median_psf, urgency_score, gross_yield, yield_confidence, rental_psf_real, rental_source_count } = financials;

  const urgencyClass = urgencyBadge(urgency_score);

  return (
    <Card className="flex flex-col border-border/60 bg-card/80 backdrop-blur-sm hover:border-primary/40 transition-colors">
      <CardContent className="pt-5 pb-3 flex-1 space-y-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm leading-tight truncate">{project_name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <p className="text-xs text-muted-foreground">
                {area}{state && state !== area ? `, ${state}` : ""}
              </p>
              {best_source && best_source !== "other" && SOURCE_LABELS[best_source] && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/50 leading-none">
                  {SOURCE_LABELS[best_source]}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge
              className={cn("border text-xs font-bold", urgencyClass)}
              variant="outline"
            >
              {urgency_score}
            </Badge>
          </div>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-1 gap-3">
          <Metric
            icon={<BarChart3 className="h-3 w-3" />}
            label={psf_confidence === "estimated" ? "Est. PSF" : "Median PSF"}
            value={psf_confidence !== "estimated" ? `${formatPSF(median_psf)} ✓` : formatPSF(median_psf)}
            highlight={psf_confidence !== "estimated"}
          />
          <Metric
            icon={<TrendingUp className="h-3 w-3" />}
            label="Gross Yield"
            value={`${gross_yield}%${yield_confidence === "real" ? " ✓" : " (est)"}`}
            highlight={yield_confidence === "real"}
          />
        </div>

        {/* TL4: Real rental data row */}
        {rental_psf_real != null && (
          <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              <span className="text-emerald-400 font-medium">Rental: </span>
              RM {rental_psf_real.toFixed(2)}/sqft/mo
            </span>
            <span className="text-emerald-400 font-medium">{rental_source_count} src</span>
          </div>
        )}

        {/* TL5: Brickz transaction history row */}
        {transaction_count > 0 && transaction_psf_low != null && transaction_psf_high != null && (
          <div className="rounded-md bg-violet-500/10 border border-violet-500/20 px-3 py-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <ArrowLeftRight className="h-3 w-3 text-violet-400" />
              <span className="text-violet-400 font-medium">Transacted: </span>
              RM {transaction_psf_low}–{transaction_psf_high} psf
            </span>
            <span className="text-violet-400 font-medium">{transaction_count} txns</span>
          </div>
        )}

        {/* Availability badge */}
        <div className={cn("rounded-md px-3 py-2 flex items-center justify-between text-xs border", AVAILABILITY_CONFIG[availability].className)}>
          <span className="font-medium">{AVAILABILITY_CONFIG[availability].label}</span>
          <span className="font-bold">{availability_pct}%</span>
        </div>

        {/* Scraped developer / status row */}
        {(scraped_developer || scraped_status) && (
          <div className="rounded-md bg-blue-500/10 border border-blue-500/20 px-3 py-2 flex items-center justify-between text-xs">
            {scraped_developer && (
              <span className="text-muted-foreground truncate max-w-[55%]">
                <span className="text-blue-400 font-medium">Dev: </span>{scraped_developer}
              </span>
            )}
            {scraped_status && (
              <span className="text-blue-400 font-medium">{scraped_status}</span>
            )}
          </div>
        )}

        {/* Completion year + total units + last seen row */}
        <div className="rounded-md bg-muted/40 px-3 py-2 grid grid-cols-3 gap-2 text-xs">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 text-muted-foreground">
              <CalendarCheck className="h-3 w-3" />
              <span>Completion</span>
            </div>
            {completion_year ? (
              <span className={cn("font-medium flex items-center gap-1", !year_verified && "text-amber-400")}>
                {completion_year}
                {year_verified
                  ? <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  : <AlertCircle className="h-3 w-3 text-amber-400" title="Year from editorial — unverified by listing" />
                }
              </span>
            ) : (
              <span className="font-medium">—</span>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Home className="h-3 w-3" />
              <span>Total Units</span>
            </div>
            <span className="font-medium">{total_units ? total_units.toLocaleString() : "—"}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Last Seen</span>
            </div>
            <span className="font-medium">{formatLastSeen(last_seen)}</span>
          </div>
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
        {best_listing_url && (
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8 px-2.5"
            title="View listing source"
            onClick={() => window.open(best_listing_url, "_blank")}
          >
            <ExternalLink className="h-3 w-3" />
            View Listing
          </Button>
        )}
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
