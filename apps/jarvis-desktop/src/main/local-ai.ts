import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * IA locale avec Ollama (sur ta carte graphique) : secours quand Claude est
 * injoignable (coupure Internet, limite d'abonnement), traitement de données
 * privées sans qu'elles quittent le PC, et banc d'essai des modèles pour tes
 * recherches en IA.
 */

type Fetch = typeof fetch;

export interface LocalModel {
  nom: string;
  tailleGo: number;
  famille?: string;
  parametres?: string;
  quantification?: string;
}

export interface BenchResult {
  modele: string;
  invite: string;
  jetonsParSeconde: number;
  premierJetonMs: number;
  dureeMs: number;
  jetons: number;
  reponse: string;
}

export const BENCH_PROMPTS = [
  "Explique en trois phrases pourquoi un pneu de course surchauffe quand il glisse.",
  "Écris une fonction TypeScript qui calcule la moyenne glissante d'un tableau de nombres sur une fenêtre de n valeurs.",
  "Un conseiller traite 42 appels par jour avec une durée moyenne de 4 min 30. Quel pourcentage d'une journée de 7 heures cela représente-t-il ? Détaille le calcul.",
];

export class LocalAI {
  private readonly fetchFn: Fetch;

  constructor(private readonly options: { url?: string; model?: string | undefined; fetchFn?: Fetch } = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  get url(): string {
    return (this.options.url ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  }

  async models(): Promise<LocalModel[]> {
    const res = await this.fetchFn(`${this.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`Ollama : erreur ${res.status}`);
    const data = (await res.json()) as { models?: Array<{ name: string; size: number; details?: { family?: string; parameter_size?: string; quantization_level?: string } }> };
    return (data.models ?? []).map((m) => ({
      nom: m.name,
      tailleGo: Math.round((m.size / 1e9) * 10) / 10,
      ...(m.details?.family ? { famille: m.details.family } : {}),
      ...(m.details?.parameter_size ? { parametres: m.details.parameter_size } : {}),
      ...(m.details?.quantization_level ? { quantification: m.details.quantization_level } : {}),
    }));
  }

  async available(): Promise<boolean> {
    return this.models()
      .then((m) => m.length > 0)
      .catch(() => false);
  }

  /** Le modèle réglé, sinon le premier d'une liste de bons généralistes, sinon le plus gros. */
  async pickModel(): Promise<string | undefined> {
    const models = await this.models().catch(() => []);
    if (!models.length) return undefined;
    if (this.options.model && models.some((m) => m.nom === this.options.model || m.nom.startsWith(`${this.options.model}:`))) return models.find((m) => m.nom === this.options.model || m.nom.startsWith(`${this.options.model}:`))!.nom;
    const preferred = ["qwen3", "mistral-small", "gemma3", "llama3.3", "llama3.1", "qwen2.5", "mistral"];
    for (const p of preferred) {
      const found = models.find((m) => m.nom.startsWith(p) && !/embed/.test(m.nom));
      if (found) return found.nom;
    }
    return [...models].filter((m) => !/embed/.test(m.nom)).sort((a, b) => b.tailleGo - a.tailleGo)[0]?.nom;
  }

  async chat(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, options: { model?: string; onText?: (delta: string) => void; signal?: AbortSignal } = {}): Promise<{ text: string; model: string; stats?: { jetons: number; jetonsParSeconde: number; premierJetonMs: number; dureeMs: number } }> {
    const model = options.model ?? (await this.pickModel());
    if (!model) throw new Error("Aucun modèle local : installe Ollama (ollama.com) puis « ollama pull qwen3:14b » par exemple.");
    const started = Date.now();
    const res = await this.fetchFn(`${this.url}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, messages, stream: true }), ...(options.signal ? { signal: options.signal } : {}) });
    if (!res.ok || !res.body) throw new Error(`Ollama : erreur ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let firstAt: number | undefined;
    let stats: { jetons: number; jetonsParSeconde: number; premierJetonMs: number; dureeMs: number } | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean; eval_count?: number; eval_duration?: number; total_duration?: number };
        const delta = chunk.message?.content ?? "";
        if (delta) {
          firstAt ??= Date.now();
          text += delta;
          options.onText?.(delta);
        }
        if (chunk.done) {
          const evalS = (chunk.eval_duration ?? 0) / 1e9;
          stats = { jetons: chunk.eval_count ?? 0, jetonsParSeconde: evalS ? Math.round(((chunk.eval_count ?? 0) / evalS) * 10) / 10 : 0, premierJetonMs: (firstAt ?? Date.now()) - started, dureeMs: Date.now() - started };
        }
      }
    }
    // Les modèles « à réflexion » écrivent <think>…</think> : on ne garde que la réponse.
    return { text: text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(), model, ...(stats ? { stats } : {}) };
  }

  /** Banc d'essai : mêmes invites pour chaque modèle, vitesse et réponses enregistrées. */
  async bench(models: string[], prompts: string[] = BENCH_PROMPTS, outDir?: string): Promise<{ resultats: BenchResult[]; fichier?: string }> {
    const resultats: BenchResult[] = [];
    for (const modele of models) {
      for (const invite of prompts) {
        try {
          const r = await this.chat([{ role: "user", content: invite }], { model: modele });
          resultats.push({ modele, invite, jetonsParSeconde: r.stats?.jetonsParSeconde ?? 0, premierJetonMs: r.stats?.premierJetonMs ?? 0, dureeMs: r.stats?.dureeMs ?? 0, jetons: r.stats?.jetons ?? 0, reponse: r.text });
        } catch (error) {
          resultats.push({ modele, invite, jetonsParSeconde: 0, premierJetonMs: 0, dureeMs: 0, jetons: 0, reponse: `Erreur : ${error instanceof Error ? error.message : String(error)}` });
        }
      }
    }
    if (!outDir) return { resultats };
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `banc-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md`);
    writeFileSync(file, benchMarkdown(resultats));
    return { resultats, fichier: file };
  }
}

export function benchMarkdown(results: BenchResult[]): string {
  const byModel = new Map<string, BenchResult[]>();
  for (const r of results) byModel.set(r.modele, [...(byModel.get(r.modele) ?? []), r]);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0);
  const lines = [
    `# Banc d'essai des modèles locaux — ${new Date().toLocaleString("fr-FR")}`,
    "",
    "| Modèle | Jetons/s (moyenne) | Premier jeton (ms) | Durée moyenne (s) |",
    "|---|---|---|---|",
    ...[...byModel.entries()].map(([m, rs]) => `| ${m} | ${avg(rs.map((r) => r.jetonsParSeconde))} | ${Math.round(avg(rs.map((r) => r.premierJetonMs)))} | ${avg(rs.map((r) => r.dureeMs / 1000))} |`),
    "",
    ...results.flatMap((r) => [`## ${r.modele} — ${r.invite}`, "", r.reponse, ""]),
  ];
  return lines.join("\n");
}

export function localPersona(ownerName: string): string {
  return `Tu es J.A.R.V.I.S., l'assistante IA de ${ownerName}, en mode local (sur son PC, sans Internet ni outils). Tu tutoies ${ownerName}, tu réponds en français, brièvement (une à trois phrases), avec un humour pince-sans-rire. Si la demande exige une action sur le PC, Internet ou des données que tu n'as pas, dis-le simplement : tu ne peux que réfléchir et répondre en mode local.`;
}
