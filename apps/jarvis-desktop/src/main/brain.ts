import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { query as sdkQuery, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { JsonStore } from "@muscu/jarvis/src/store.js";
import { decide, type PolicyContext } from "../shared/policy.js";

/**
 * Le cerveau : Claude par le SDK officiel Claude Agent, comme Nitro70. Sans clé
 * API, il utilise la connexion de Claude Code sur ce PC, donc l'abonnement
 * d'Alex ; avec ANTHROPIC_API_KEY, il utilise la clé (facturée à l'usage).
 */

export interface BrainEvents {
  /** Morceau de réponse au fil de l'eau, pour commencer à parler sans attendre la fin. */
  onText?: (delta: string) => void;
  /** Un outil démarre (pour l'affichage : « je regarde ton écran… »). */
  onTool?: (name: string, input: unknown) => void;
}

export interface BrainReply {
  text: string;
  costUsd?: number;
  error?: string;
}

export type QueryFn = typeof sdkQuery;

/**
 * Le moteur Claude (claude.exe) : celui embarqué dans l'installateur, sinon le
 * Claude Code installé sur le PC, sinon celui du SDK (mode développement).
 */
export function findClaudeExecutable(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync, resources = (process as { resourcesPath?: string }).resourcesPath): string | undefined {
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  const candidates = [
    env.CLAUDE_CODE_CHEMIN?.trim(),
    resources ? path.join(resources, "claude", exe) : undefined,
    path.join(homedir(), ".local", "bin", exe),
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs", "claude", exe) : undefined,
    env.APPDATA ? path.join(env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", exe) : undefined,
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => exists(p));
}

interface SessionState {
  sessionId?: string;
  startedAt?: string;
}

export interface BrainOptions {
  dataDir: string;
  workspace: string;
  /** Recalculée au début de chaque nouvelle conversation (pour y mettre la mémoire à jour). */
  systemPrompt: string | (() => string);
  mcpServers: Options["mcpServers"];
  model?: string | undefined;
  queryFn?: QueryFn;
  /** Dossier des documents de travail (lus seulement avec pseudonymes). */
  workFolder?: string | undefined;
  /** Chaque décision sur un outil (pour le journal des actions). */
  onDecision?: (tool: string, input: Record<string, unknown>, allowed: boolean, reason: string | undefined, trust: PolicyContext["trust"]) => void;
  /** Juste avant qu'un outil modifie un fichier (pour en garder une copie). */
  beforeFileChange?: (file: string) => void;
}

export interface AskOptions {
  /** Conversation à part (ne touche pas à la conversation principale). */
  separate?: boolean;
  /** « inconnu » : la voix n'a pas été reconnue, Jarvis ne fait que répondre. */
  trust?: PolicyContext["trust"];
}

export class Brain {
  private readonly state: JsonStore<SessionState>;
  private queue: Promise<unknown> = Promise.resolve();
  private current: AbortController | undefined;
  private executableCache: string | null | undefined;

  private get executable(): string | undefined {
    if (this.executableCache === undefined) this.executableCache = this.options.queryFn ? null : (findClaudeExecutable() ?? null);
    return this.executableCache ?? undefined;
  }

  constructor(private readonly options: BrainOptions) {
    this.state = new JsonStore(options.dataDir, "session", () => ({}));
  }

  /** Une demande à la fois ; la suivante attend (comme une vraie conversation). */
  ask(prompt: string, events: BrainEvents = {}, opts: AskOptions = {}): Promise<BrainReply> {
    const run = () => this.run(prompt, events, opts.separate === true || opts.trust === "inconnu", undefined, opts.trust);
    const next = this.queue.catch(() => undefined).then(run);
    this.queue = next;
    return next;
  }

  /** Tâche de fond : tourne à côté de la conversation, sans l'attendre ni la bloquer. */
  askDetached(prompt: string, events: BrainEvents, signal: AbortSignal): Promise<BrainReply> {
    const abort = new AbortController();
    signal.addEventListener("abort", () => abort.abort(), { once: true });
    return this.run(prompt, events, true, abort);
  }

  /** « Stop » : interrompt la tâche en cours. */
  stop(): void {
    this.current?.abort();
  }

  /** Nouvelle conversation (la mémoire durable reste). */
  reset(): void {
    this.state.write({});
  }

  private async run(prompt: string, events: BrainEvents, separate: boolean, external?: AbortController, trust: PolicyContext["trust"] = "proprietaire"): Promise<BrainReply> {
    const session = separate ? {} : this.state.read();
    const abort = external ?? new AbortController();
    if (!external) this.current = abort;
    const context: PolicyContext = { trust, workFolder: this.options.workFolder };
    const options: Options = {
      cwd: this.options.workspace,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: typeof this.options.systemPrompt === "function" ? this.options.systemPrompt() : this.options.systemPrompt,
      },
      mcpServers: this.options.mcpServers,
      settingSources: [],
      permissionMode: "default",
      canUseTool: async (toolName, input) => {
        const decision = decide(toolName, input, context);
        this.options.onDecision?.(toolName, input, decision.allow, decision.reason, trust);
        return decision.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: decision.reason ?? "Bloqué." };
      },
      // Les outils de lecture ne passent pas par canUseTool : ce crochet voit tout, et garde une copie des fichiers modifiés.
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (hookInput) => {
                const h = hookInput as { tool_name?: string; tool_input?: Record<string, unknown> };
                const name = h.tool_name ?? "";
                const toolInput = h.tool_input ?? {};
                const decision = decide(name, toolInput, context);
                if (!decision.allow) {
                  this.options.onDecision?.(name, toolInput, false, decision.reason, trust);
                  return { hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "deny" as const, permissionDecisionReason: decision.reason ?? "Bloqué." } };
                }
                if (["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(name)) {
                  const file = String(toolInput.file_path ?? toolInput.notebook_path ?? "");
                  if (file) this.options.beforeFileChange?.(file);
                }
                if (["Read", "Grep", "Glob", "WebSearch", "WebFetch"].includes(name)) this.options.onDecision?.(name, toolInput, true, undefined, trust);
                return {};
              },
            ],
          },
        ],
      },
      includePartialMessages: true,
      abortController: abort,
      maxTurns: 60,
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.executable ? { pathToClaudeCodeExecutable: this.executable } : {}),
      ...(session.sessionId ? { resume: session.sessionId } : {}),
    };

    let text = "";
    let finalText = "";
    let costUsd: number | undefined;
    let error: string | undefined;
    try {
      for await (const message of this.options.queryFn ? this.options.queryFn({ prompt, options }) : sdkQuery({ prompt, options })) {
        this.handle(message as SDKMessage, events, (delta) => (text += delta));
        if (message.type === "system" && "session_id" in message && !separate) {
          this.state.write({ sessionId: message.session_id, startedAt: session.startedAt ?? new Date().toISOString() });
        }
        if (message.type === "result") {
          costUsd = "total_cost_usd" in message ? (message.total_cost_usd as number) : undefined;
          if (message.subtype === "success") finalText = message.result;
          else error = message.subtype;
        }
      }
    } catch (caught) {
      if (abort.signal.aborted) return { text: "D'accord, j'arrête.", ...(costUsd !== undefined ? { costUsd } : {}) };
      error = caught instanceof Error ? caught.message : String(caught);
      // Session introuvable ou abîmée : on repart d'une conversation neuve la fois suivante.
      if (session.sessionId && /session|resume|conversation/i.test(error)) this.reset();
    } finally {
      if (!external) this.current = undefined;
    }
    const reply = (finalText || text).trim();
    if (!reply && error) {
      console.error("[cerveau]", error);
      return { text: explain(error), error };
    }
    return { text: reply || "C'est fait.", ...(costUsd !== undefined ? { costUsd } : {}), ...(error ? { error } : {}) };
  }

  private handle(message: SDKMessage, events: BrainEvents, append: (delta: string) => void): void {
    if (message.type === "stream_event") {
      const event = message.event;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta" && message.parent_tool_use_id === null) {
        append(event.delta.text);
        events.onText?.(event.delta.text);
      }
      return;
    }
    if (message.type === "assistant" && message.parent_tool_use_id === null) {
      for (const block of message.message.content) {
        if (block.type === "tool_use") events.onTool?.(block.name, block.input);
      }
    }
  }
}

/** Les erreurs techniques (souvent en anglais) expliquées en français. */
export function explain(error: string): string {
  if (/native cli binary|pathToClaudeCodeExecutable|ENOENT.*claude|spawn .*claude/i.test(error)) {
    return "Mon moteur Claude est introuvable sur ce PC. Installe Claude Code (dans PowerShell : irm https://claude.ai/install.ps1 | iex), connecte-toi avec « claude », puis redémarre-moi.";
  }
  if (/login|auth|credential|401|not logged|invalid api key|oauth/i.test(error)) {
    return "Je n'arrive pas à me connecter à Claude. Ouvre PowerShell, lance « claude » et connecte-toi avec ton compte.";
  }
  if (/rate|limit|429|usage|quota/i.test(error)) return "J'ai atteint la limite d'utilisation de ton abonnement pour le moment. Réessaie un peu plus tard.";
  if (/ENOTFOUND|network|fetch failed|ECONN|ETIMEDOUT|socket hang up/i.test(error)) return "Je n'ai plus accès à Internet.";
  if (/overloaded|529|503|502/i.test(error)) return "Les serveurs de Claude sont surchargés. Je réessaierai dans un instant.";
  if (/max.?turns/i.test(error)) return "La tâche était trop longue pour être faite d'un seul tenant. Demande-moi de la lancer en tâche de fond.";
  if (/abort/i.test(error)) return "D'accord, j'arrête.";
  return "J'ai eu un problème technique. Le détail est dans le journal d'erreurs ; la page Diagnostic peut aider.";
}
