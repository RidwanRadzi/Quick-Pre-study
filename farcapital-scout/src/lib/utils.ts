import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRM(value: number): string {
  if (value >= 1_000_000) return `RM ${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `RM ${(value / 1_000).toFixed(0)}K`;
  return `RM ${value.toFixed(0)}`;
}

export function formatPSF(value: number): string {
  return `RM ${value.toFixed(0)} psf`;
}

export function urgencyColor(score: number): string {
  if (score >= 70) return "text-green-500";
  if (score >= 40) return "text-yellow-500";
  return "text-red-400";
}

export function urgencyBadge(score: number): string {
  if (score >= 70) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (score >= 40) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}

/** Malaysian state lookup from area string */
export function inferState(area: string): string {
  const map: Record<string, string> = {
    rawang: "Selangor",
    kepong: "Kuala Lumpur",
    cheras: "Kuala Lumpur",
    ampang: "Selangor",
    puchong: "Selangor",
    subang: "Selangor",
    "shah alam": "Selangor",
    klang: "Selangor",
    petaling: "Selangor",
    kl: "Kuala Lumpur",
    "kuala lumpur": "Kuala Lumpur",
    bangsar: "Kuala Lumpur",
    mont: "Kuala Lumpur",
    "mont kiara": "Kuala Lumpur",
    damansara: "Selangor",
    setapak: "Kuala Lumpur",
    wangsa: "Kuala Lumpur",
    batu: "Kuala Lumpur",
    johor: "Johor",
    penang: "Pulau Pinang",
    ipoh: "Perak",
    cyberjaya: "Selangor",
    putrajaya: "Putrajaya",
    sepang: "Selangor",
    "nilai": "Negeri Sembilan",
    "seremban": "Negeri Sembilan",
    "kota damansara": "Selangor",
    "bukit jalil": "Kuala Lumpur",
    "sri petaling": "Kuala Lumpur",
    semenyih: "Selangor",
    kajang: "Selangor",
    bangi: "Selangor",
  };
  const lower = area.toLowerCase();
  for (const [key, state] of Object.entries(map)) {
    if (lower.includes(key)) return state;
  }
  return "Selangor"; // safe default
}

/** Build the QPS deep-link URL */
export function buildQpsUrl(baseUrl: string, project: { name: string; area: string; state?: string }): string {
  const params = new URLSearchParams({
    proj: project.name,
    state: project.state || inferState(project.area),
  });
  return `${baseUrl.replace(/\/$/, "")}?${params.toString()}`;
}
