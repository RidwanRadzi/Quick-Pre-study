import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Bot, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PropertyCard } from "@/components/PropertyCard";
import { SmartSuggestions } from "@/components/SmartSuggestions";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage, PropertyProject } from "@/types/property";

export function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingProject, setSavingProject] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.message || "Selesai. Ini hasil carian property.",
        projects: data.projects || [],
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Search failed", { description: msg });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Maaf, ada masalah dengan carian. Cuba semula ya.",
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  async function saveToTracker(project: PropertyProject) {
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
          notes: null,
        },
        { onConflict: "project_name" }
      );
      if (error) throw error;
      toast.success(`${project.project_name} added to Acquisition Tracker`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error("Could not save project", { description: msg });
    } finally {
      setSavingProject(null);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">FarCapital Scout</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Cari property Malaysia. Tanya dalam Bahasa Melayu atau English — kami parse intent dan cari listing
                terbaik untuk anda.
              </p>
            </div>
            <SmartSuggestions onSelect={(s) => sendMessage(s)} />
          </div>
        ) : (
          messages.map((msg, i) => <MessageRow key={i} msg={msg} onSave={saveToTracker} savingProject={savingProject} />)
        )}

        {loading && (
          <div className="flex items-start gap-3">
            <BotAvatar />
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/40 rounded-lg px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Sedang cari property…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
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
            placeholder="cari projek siap Rawang below 400k…"
            className="flex-1 bg-background/60"
            disabled={loading}
          />
          <Button type="submit" size="icon" disabled={loading || !input.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}

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
