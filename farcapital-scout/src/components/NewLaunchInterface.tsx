import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Bot, User, Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewLaunchCard } from "@/components/NewLaunchCard";
import { supabase } from "@/integrations/supabase/client";
import type { NewLaunchMessage, NewLaunchProject } from "@/types/property";

const LOCATION_CHIPS = [
  "Shah Alam", "Petaling Jaya", "Cheras", "Cyberjaya",
  "Johor Bahru", "Penang", "Kuala Lumpur", "Subang Jaya",
];

const LOADING_STEPS = [
  "Searching top 10 developer websites…",
  "Checking PropertyGuru new launches…",
  "Expanding to top 50 developers if needed…",
  "Compiling results…",
];
const STEP_INTERVALS = [0, 3000, 6500, 10000];

export function NewLaunchInterface() {
  const [messages, setMessages] = useState<NewLaunchMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!loading) { setLoadingStep(0); return; }
    setLoadingStep(0);
    const timers = STEP_INTERVALS.slice(1).map((delay, i) =>
      setTimeout(() => setLoadingStep(i + 1), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  async function sendMessage(text: string) {
    const query = text.trim();
    if (!query || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setInput("");
    setLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("new-launches", {
        body: { message: query },
      });
      if (error) throw error;

      const launches: NewLaunchProject[] = data.launches ?? [];
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.message || (launches.length > 0
            ? `Jumpa ${launches.length} new launch.`
            : "Tiada new launch ditemui. Cuba area lain."),
          launches,
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Search failed", { description: msg });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Maaf, ada masalah dengan carian. Cuba semula." },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">

        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
            <div className="space-y-2">
              <div className="flex items-center justify-center gap-2">
                <Rocket className="h-5 w-5 text-amber-400" />
                <h2 className="text-xl font-semibold">New Launches</h2>
              </div>
              <p className="text-sm text-muted-foreground max-w-sm">
                Cari <span className="text-amber-400 font-medium">new launch</span> dari{" "}
                <span className="font-medium">Top 10 developer Malaysia</span> — jika kurang hasil,
                kami expand ke Top 50. Taip lokasi di bawah.
              </p>
            </div>

            {/* Location chips */}
            <div className="space-y-2 w-full max-w-md">
              <p className="text-xs text-muted-foreground">Pilih lokasi:</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {LOCATION_CHIPS.map((loc) => (
                  <Button
                    key={loc}
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 rounded-full border-amber-500/30 hover:border-amber-400/60 hover:text-amber-400"
                    onClick={() => sendMessage(loc)}
                  >
                    {loc}
                  </Button>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground/60">
              Hasil bukan subsale — hanya developer new launch sahaja.
            </p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <NewLaunchMessageRow key={i} msg={msg} />
          ))
        )}

        {/* Multi-step loading */}
        {loading && (
          <div className="flex items-start gap-3">
            <BotAvatar />
            <div className="flex flex-col gap-2 bg-muted/40 rounded-lg px-4 py-3 text-sm text-muted-foreground max-w-xs">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin shrink-0 text-amber-400" />
                <span>{LOADING_STEPS[loadingStep]}</span>
              </div>
              <div className="flex gap-1.5 pl-6">
                {LOADING_STEPS.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${
                      i <= loadingStep ? "bg-amber-400" : "bg-border"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border/60 px-4 py-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
        >
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="contoh: Shah Alam, Johor Bahru, Penang…"
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

function NewLaunchMessageRow({ msg }: { msg: NewLaunchMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {isUser ? <UserAvatar /> : <BotAvatar />}
      <div className={`flex flex-col gap-3 max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        <div className={`rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted/60 text-foreground"
        }`}>
          {msg.content}
        </div>

        {msg.launches && msg.launches.length > 0 && (
          <div className="w-full grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-1">
            {msg.launches.map((l) => (
              <NewLaunchCard key={`${l.project_name}-${l.developer}`} launch={l} />
            ))}
          </div>
        )}

        {msg.role === "assistant" && msg.launches && msg.launches.length === 0 && (
          <p className="text-xs text-muted-foreground/70 italic">
            Cuba area berbeza atau semak terus laman web developer.
          </p>
        )}
      </div>
    </div>
  );
}

function BotAvatar() {
  return (
    <div className="h-8 w-8 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
      <Rocket className="h-4 w-4 text-amber-400" />
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
