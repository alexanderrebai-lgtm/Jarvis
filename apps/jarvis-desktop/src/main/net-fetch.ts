/**
 * Réseau plus solide pour les services en ligne (Spotify…). Le « fetch » de
 * Node ne voit ni le proxy de Windows ni les certificats ajoutés par certains
 * antivirus : en cas d'échec réseau, on réessaie avec le réseau de Chromium
 * (celui du navigateur intégré), puis on explique l'échec en français.
 */

type Fetch = typeof fetch;

function causeCode(error: unknown): string {
  const e = error as { code?: string; cause?: { code?: string; message?: string } };
  return String(e?.cause?.code ?? e?.code ?? e?.cause?.message ?? (error instanceof Error ? error.message : error) ?? "");
}

/** Vrai pour une panne réseau (pas une réponse d'erreur du service). */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|CERT|ERR_/i.test(causeCode(error));
}

export function explainNetwork(error: unknown, service = "Le service"): string {
  const code = causeCode(error);
  if (/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(code)) return `${service} est injoignable : pas d'Internet sur le PC (ou nom de serveur introuvable).`;
  if (/TIMEOUT|ETIMEDOUT|ERR_TIMED_OUT/i.test(code)) return `${service} ne répond pas (délai dépassé). Ça revient souvent tout seul.`;
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_CERT/i.test(code)) return `${service} : la connexion sécurisée est interceptée (antivirus qui analyse le HTTPS, ou proxy). Ajoute Jarvis aux exceptions de l'antivirus.`;
  if (/ECONNRESET|ECONNREFUSED|ERR_CONNECTION/i.test(code)) return `${service} a coupé la connexion. Réessaie dans un instant.`;
  return `${service} est injoignable (réseau${code && code !== "fetch failed" ? ` : ${code}` : ""}).`;
}

/** fetch qui retente une fois par le réseau de Chromium, puis donne une erreur lisible. */
export function resilientFetch(primary: Fetch, fallback: () => Fetch | undefined, service: string): Fetch {
  return (async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    try {
      return await primary(input, init);
    } catch (first) {
      if (!isNetworkError(first)) throw first;
      const other = fallback();
      if (other) {
        try {
          return await other(input, init);
        } catch (second) {
          throw new Error(explainNetwork(second, service));
        }
      }
      throw new Error(explainNetwork(first, service));
    }
  }) as Fetch;
}
