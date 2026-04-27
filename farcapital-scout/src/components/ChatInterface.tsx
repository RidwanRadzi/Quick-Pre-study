import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Bot, User, BookmarkPlus, X, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PropertyCard } from "@/components/PropertyCard";
import { SmartSuggestions } from "@/components/SmartSuggestions";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage, PropertyProject } from "@/types/property";

// ---------------------------------------------------------------------------
// Multi-step loading messages — shown sequentially while the search runs
// ---------------------------------------------------------------------------
const LOADING_STEPS = [
  "Searching editorial sources for completed projects…",
  "Verifying developer listings on portals…",
  "Analysing financials and availability…",
  "Finalising results…",
];
const STEP_INTERVALS = [0, 3500, 7500, 12000]; // ms from search start

// ---------------------------------------------------------------------------
// Notes modal
// ---------------------------------------------------------------------------
interface NotesModalProps {
  project: PropertyProject;
  onConfirm: (notes: string) => void;
  onCancel: () => void;
  saving: boolean;
}

function NotesModal({ project, onConfirm, onCancel, saving }: NotesModalProps) {
  const [notes, setNotes] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-sm leading-tight flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-primary shrink-0" />
              Track Project
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 ml-6">{project.project_name}</p>
          </div>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Notes textarea */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Research Notes <span className="font-normal">(optional)</span>
          </label>
          <textarea
            ref={textRef}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Met agent on site — 40 units left, developer offering 3% rebate. Worth deeper study."
            rows={4}
            className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
          />
          <p className="text-[10px] text-muted-foreground/60">Notes will be saved to the Acquisition Tracker.</p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="sm" className="text-xs" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => onConfirm(notes.trim())}
            disabled={saving}
          >
            {saving
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>
              : <><BookmarkPlus className="h-3 w-3" /> Add to Tracker</>
            }
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ChatInterface
// ---------------------------------------------------------------------------
export function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);

  // Notes modal state
  const [pendingProject, setPendingProject] = useState<PropertyProject | null>(null);
  const [savingProject, setSavingProject] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Progress through loading steps while search is running
  useEffect(() => {
    if (!loading) {
      setLoadingStep(0);
      return;
    }
    setLoadingStep(0);
    const timers = STEP_INTERVALS.slice(1).map((delay, i) =>
      setTimeout(() => setLoadingStep(i + 1), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  async function sendMessage(text: string) {
    const query = text.trim();
    if (!query || loading) return;

    const userMsg: ChatMessage = { role: "user", content: query };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("property-search", {
        body: { message: query },
      });

      if (error) throw error;

      const projects: PropertyProject[] = data.projects || [];
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: projects.length > 0
          ? (data.message || "Selesai. Ini hasil carian property.")
          : (data.message || "Tiada projek VP/OC ditemui untuk carian ini. Cuba lokasi atau jenis property lain."),
        projects,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Search failed", { description: msg });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Maaf, ada masalah dengan carian. Cuba semula ya." },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  // Open notes modal
  function openNotesModal(project: PropertyProject) {
    setPendingProject(project);
  }

  // Confirm track with notes
  async function confirmTrack(notes: string) {
    if (!pendingProject) return;
    const project = pendingProject;
    setSavingProject(project.project_name);

    try {
      const { error } = await supabase.from("projects").upsert(
        {
          project_name: project.project_name,
          area: project.area,
          state: project.state,
          listing_count: project.listing_count,
          median_psf: project.financials.median_psf,
          gross_yield: project.financials.gross_yield,
          be_psf: project.financials.be_psf,
          urgency_score: project.financials.urgency_score,
          pipeline_status: "watchlist",
          raw_listings: project.listings as unknown as never,
          notes: notes || null,
          // Trust level fields
          psf_confidence: project.psf_confidence,
          psf_source_count: project.psf_source_count,
          rental_psf_real: project.financials.rental_psf_real,
          rental_source_count: project.financials.rental_source_count,
          yield_confidence: project.financials.yield_confidence,
          transaction_psf_low: project.transaction_psf_low,
          transaction_psf_high: project.transaction_psf_high,
          transaction_count: project.transaction_count,
          // Enrichment metadata
          completion_year: project.completion_year,
          total_units: project.total_units,
          availability: project.availability,
          availability_pct: project.availability_pct,
          scraped_developer: project.scraped_developer,
          best_listing_url: project.best_listing_url,
        },
        { onConflict: "project_name" }
      );
      if (error) throw error;

      toast.success(`${project.project_name} added to Acquisition Tracker`);
      setPendingProject(null);

      // Fire-and-forget sync to Google Sheets
      supabase.functions
        .invoke("sheets-sync", { body: { action: "sync_one", project_name: project.project_name } })
        .catch((err) => console.warn("sheets-sync fire-and-forget failed:", err));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error("Could not save project", { description: msg });
    } finally {
      setSavingProject(null);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* Notes modal — rendered outside the scroll container */}
      {pendingProject && (
        <NotesModal
          project={pendingProject}
          onConfirm={confirmTrack}
          onCancel={() => setPendingProject(null)}
          saving={savingProject === pendingProject.project_name}
        />
      )}

      <div className="flex flex-col h-full">
        {/* Message thread */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">FarCapital Scout</h2>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Cari projek <span className="text-primary font-medium">VP / OC siap</span> untuk
                  kajian pelaburan. Taip lokasi atau jenis property di bawah.
                </p>
              </div>
              <SmartSuggestions onSelect={(s) => sendMessage(s)} />
            </div>
          ) : (
            messages.map((msg, i) => (
              <MessageRow
                key={i}
                msg={msg}
                onSave={openNotesModal}
                savingProject={savingProject}
              />
            ))
          )}

          {/* Multi-step loading indicator */}
          {loading && (
            <div className="flex items-start gap-3">
              <BotAvatar />
              <div className="flex flex-col gap-2 bg-muted/40 rounded-lg px-4 py-3 text-sm text-muted-foreground max-w-xs">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />
                  <span>{LOADING_STEPS[loadingStep]}</span>
                </div>
                {/* Step dots */}
                <div className="flex gap-1.5 pl-6">
                  {LOADING_STEPS.map((_, i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${
                        i <= loadingStep ? "bg-primary" : "bg-border"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="border-t border-border/60 px-4 py-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="contoh: projek siap VP Rawang below 400k…"
              className="flex-1 bg-background/60"
              disabled={loading}
            />
            <Button type="submit" size="icon" disabled={loading || !input.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function MessageRow({
  msg,
  onSave,
  savingProject,
}: {
  msg: ChatMessage;
  onSave: (p: PropertyProject) => void;
  savingProject: string | null;
}) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {isUser ? <UserAvatar /> : <BotAvatar />}
      <div className={`flex flex-col gap-3 max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
            isUser ? "bg-primary text-primary-foreground" : "bg-muted/60 text-foreground"
          }`}
        >
          {msg.content}
        </div>

        {/* Property result cards */}
        {msg.projects && msg.projects.length > 0 && (
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-1">
            {msg.projects.map((p) => (
              <PropertyCard
                key={p.project_name}
                project={p}
                onSave={onSave}
                saving={savingProject === p.project_name}
              />
            ))}
          </div>
        )}

        {/* Empty results hint */}
        {msg.role === "assistant" && msg.projects && msg.projects.length === 0 && (
          <p className="text-xs text-muted-foreground/70 italic">
            Tiada projek VP/OC ditemui — cuba lokasi berbeza atau semak ejaan.
          </p>
        )}
      </div>
    </div>
  );
}

function BotAvatar() {
  return (
    <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
      <Bot className="h-4 w-4 text-primary" />
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
      <User className="h-4 w-4" />
    </div>
  );
}
