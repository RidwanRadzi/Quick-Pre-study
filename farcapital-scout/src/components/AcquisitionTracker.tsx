import { useEffect, useState } from "react";
import { Trash2, ExternalLink, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatPSF, urgencyBadge, buildQpsUrl } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { TrackedProject, PipelineStatus } from "@/types/property";

const QPS_URL = import.meta.env.VITE_QPS_URL || "https://quick-pre-study.vercel.app";

const STATUS_OPTIONS: { value: PipelineStatus; label: string; color: string }[] = [
  { value: "watchlist", label: "Watchlist", color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  { value: "researching", label: "Researching", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { value: "site_visit", label: "Site Visit", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  { value: "offer_made", label: "Offer Made", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  { value: "acquired", label: "Acquired", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  { value: "passed", label: "Passed", color: "bg-red-500/20 text-red-400 border-red-500/30" },
];

function statusColor(status: PipelineStatus) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.color ?? "";
}
function statusLabel(status: PipelineStatus) {
  return STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
}

export function AcquisitionTracker() {
  const [projects, setProjects] = useState<TrackedProject[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchProjects() {
    setLoading(true);
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Failed to load tracker", { description: error.message });
    } else {
      setProjects((data ?? []) as TrackedProject[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void fetchProjects();
  }, []);

  async function updateStatus(id: string, status: PipelineStatus) {
    const { error } = await supabase.from("projects").update({ pipeline_status: status }).eq("id", id);
    if (error) {
      toast.error("Update failed", { description: error.message });
    } else {
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, pipeline_status: status } : p)));
    }
  }

  async function deleteProject(id: string, name: string) {
    if (!confirm(`Delete ${name} from tracker?`)) return;
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) {
      toast.error("Delete failed", { description: error.message });
    } else {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast.success(`${name} removed from tracker`);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading tracker…</div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
        <p className="text-muted-foreground text-sm">No projects tracked yet.</p>
        <p className="text-xs text-muted-foreground/60">Use the Scout to find projects, then click "Track".</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 text-muted-foreground text-xs">
            <th className="text-left py-2 pr-4 font-medium">Project</th>
            <th className="text-right py-2 pr-4 font-medium">Median PSF</th>
            <th className="text-right py-2 pr-4 font-medium">Yield</th>
            <th className="text-right py-2 pr-4 font-medium">BE PSF</th>
            <th className="text-right py-2 pr-4 font-medium">Urgency</th>
            <th className="text-left py-2 pr-4 font-medium">Status</th>
            <th className="py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {projects.map((p) => (
            <tr key={p.id} className="hover:bg-muted/20 transition-colors">
              <td className="py-3 pr-4">
                <div className="font-medium leading-tight">{p.project_name}</div>
                <div className="text-xs text-muted-foreground">{p.area}</div>
              </td>
              <td className="text-right py-3 pr-4 tabular-nums">{formatPSF(p.median_psf)}</td>
              <td className="text-right py-3 pr-4 tabular-nums">
                <span className={p.gross_yield >= 5 ? "text-primary font-medium" : ""}>
                  {p.gross_yield.toFixed(1)}%
                </span>
              </td>
              <td className="text-right py-3 pr-4 tabular-nums">{formatPSF(p.be_psf)}</td>
              <td className="text-right py-3 pr-4">
                <Badge className={cn("border text-xs", urgencyBadge(p.urgency_score))} variant="outline">
                  {p.urgency_score}
                </Badge>
              </td>
              <td className="py-3 pr-4">
                <Select
                  value={p.pipeline_status}
                  onValueChange={(v) => updateStatus(p.id, v as PipelineStatus)}
                >
                  <SelectTrigger className={cn("h-7 text-xs w-36 border", statusColor(p.pipeline_status))}>
                    <SelectValue>{statusLabel(p.pipeline_status)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td className="py-3">
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Open in QPS"
                    onClick={() =>
                      window.open(buildQpsUrl(QPS_URL, { name: p.project_name, area: p.area, state: p.state }), "_blank")
                    }
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    title="Remove"
                    onClick={() => deleteProject(p.id, p.project_name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Summary row */}
      <div className="mt-4 pt-3 border-t border-border/40 flex gap-6 text-xs text-muted-foreground">
        {STATUS_OPTIONS.map((opt) => {
          const count = projects.filter((p) => p.pipeline_status === opt.value).length;
          if (!count) return null;
          return (
            <span key={opt.value}>
              <Badge className={cn("mr-1 border text-[10px]", opt.color)} variant="outline">
                {count}
              </Badge>
              {opt.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
