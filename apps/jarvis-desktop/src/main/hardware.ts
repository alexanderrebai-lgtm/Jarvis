import os from "node:os";

/**
 * Profil matériel : Jarvis adapte ses réglages au PC (cœurs du processeur,
 * mémoire, carte graphique dédiée, puce graphique intégrée).
 */

export interface HardwareProfile {
  coeurs: number;
  threads: number;
  ramGo: number;
  /** Carte graphique dédiée NVIDIA (modèle et mémoire vidéo en Mo). */
  nvidia?: { modele: string; vramMo: number };
  /** Puce graphique intégrée au processeur (Radeon des Ryzen « G », Intel UHD/Iris). */
  integre?: { modele: string };
}

export interface GpuController {
  vendor?: string;
  model?: string;
  vram?: number | null;
}

export function buildProfile(cpu: { physicalCores?: number; cores?: number }, totalMemBytes: number, controllers: GpuController[]): HardwareProfile {
  const threads = cpu.cores || os.cpus().length || 4;
  const profile: HardwareProfile = { coeurs: cpu.physicalCores || Math.max(1, Math.round(threads / 2)), threads, ramGo: Math.round(totalMemBytes / 1024 ** 3) };
  for (const c of controllers) {
    const name = `${c.vendor ?? ""} ${c.model ?? ""}`;
    if (/nvidia|geforce|rtx|gtx/i.test(name) && !profile.nvidia) profile.nvidia = { modele: (c.model ?? "NVIDIA").trim(), vramMo: Math.max(0, c.vram ?? 0) };
    // Puce intégrée : Radeon d'un Ryzen « G » (« Radeon Graphics », « Vega ») ou Intel UHD/Iris. Une Radeon RX dédiée n'en est pas une.
    else if (/(radeon\(tm\)? graphics|radeon graphics|vega \d|uhd graphics|iris|intel\(r\) graphics)/i.test(name) && !/\brx\b/i.test(name)) profile.integre = { modele: (c.model ?? "intégrée").trim() };
  }
  return profile;
}

export interface Tuning {
  /** Threads ONNX (reconnaissance vocale, empreinte vocale, bibliothèque) en temps normal et pendant un jeu. */
  threadsNormal: number;
  threadsJeu: number;
  /** Threads PyTorch pour la voix locale (le gros du calcul est sur la carte graphique). */
  threadsVoix: number;
  /** Modèle local conseillé pour Ollama (doit tenir entièrement dans la mémoire vidéo). */
  ollamaConseille: string;
  /** Fenêtres de pages cachées gardées en mémoire combien de temps (ms). */
  pagesCacheesMs: number;
}

export function tune(p: HardwareProfile): Tuning {
  const vram = p.nvidia?.vramMo ?? 0;
  return {
    // La moitié des cœurs physiques en temps normal (Jarvis n'a pas besoin de tout le processeur), 2 pendant un jeu.
    threadsNormal: Math.max(2, Math.min(8, Math.floor(p.coeurs / 2) || 2)),
    threadsJeu: 2,
    threadsVoix: Math.max(2, Math.min(4, Math.floor(p.coeurs / 2))),
    ollamaConseille: vram >= 14_000 ? "qwen3:14b" : vram >= 7_000 ? "qwen3:8b" : vram >= 4_000 ? "qwen3:4b" : "qwen3:1.7b",
    // Avec 16 Go ou moins, une page fermée libère sa mémoire après 5 minutes.
    pagesCacheesMs: p.ramGo <= 16 ? 5 * 60_000 : 20 * 60_000,
  };
}

/** Résumé lisible pour le diagnostic. */
export function describeProfile(p: HardwareProfile, t: Tuning): string {
  return [
    `${p.coeurs} cœurs / ${p.threads} threads, ${p.ramGo} Go de mémoire`,
    p.nvidia ? `${p.nvidia.modele} (${Math.round(p.nvidia.vramMo / 1024)} Go)` : "pas de carte NVIDIA",
    p.integre ? `puce intégrée ${p.integre.modele}` : "",
    `calculs de Jarvis sur ${t.threadsNormal} threads (${t.threadsJeu} en jeu)`,
  ]
    .filter(Boolean)
    .join(" · ");
}
