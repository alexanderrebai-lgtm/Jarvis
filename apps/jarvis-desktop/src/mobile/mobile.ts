/**
 * Jarvis Mobile : l'application du téléphone (servie par le PC, voir src/main/mobile.ts).
 * Légère, sans dépendance : discuter, état, maison, mémoire, journal.
 */

const app = document.getElementById("app")!;

const esc = (t: unknown): string => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const jour = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

type Niveau = "chiffre" | "maison" | "?";
let niveau: Niveau = "?";

class ErreurAuth extends Error {}

async function poster(chemin: string, corps: unknown, delaiMs = 0): Promise<any> {
  let r: Response;
  try {
    r = await fetch(chemin, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(corps), ...(delaiMs ? { signal: AbortSignal.timeout(delaiMs) } : {}) });
  } catch (e) {
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) throw new Error("Jarvis met trop de temps à répondre : il continue peut-être sur le PC. Regarde le Journal.");
    throw new Error("Le PC n'est pas joignable (allumé ? Tailscale actif ?).");
  }
  if (r.status === 401) throw new ErreurAuth("Accès perdu");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erreur ?? `Erreur ${r.status}`);
  return j;
}
const appel = async <T = any>(canal: string, payload?: unknown): Promise<T> => (await poster("/api/invoke", { canal, payload })).resultat as T;

// ---------- Coque : en-tête, onglets ----------

const ONGLETS = [
  { id: "discuter", nom: "Discuter", icone: "💬", complet: false },
  { id: "etat", nom: "État", icone: "📊", complet: false },
  { id: "maison", nom: "Maison", icone: "🏠", complet: true },
  { id: "memoire", nom: "Mémoire", icone: "🧠", complet: true },
  { id: "journal", nom: "Journal", icone: "📋", complet: true },
] as const;
type OngletId = (typeof ONGLETS)[number]["id"];
let actif: OngletId = (localStorage.getItem("jv-onglet") as OngletId | null) ?? "discuter";
if (!ONGLETS.some((o) => o.id === actif)) actif = "discuter";

app.innerHTML = `<header><h1>JARVIS</h1><span class="badge" id="badge">…</span></header><div id="bandeau"></div><div id="approbations"></div><main id="vue"></main><div id="compose-zone"></div><nav id="onglets"></nav>`;
const vue = document.getElementById("vue")!;
const zone = document.getElementById("compose-zone")!;
const nav = document.getElementById("onglets")!;
nav.innerHTML = ONGLETS.map((o) => `<button data-o="${o.id}"><span class="i">${o.icone}</span>${o.nom}</button>`).join("");
nav.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.onclick = () => ouvrir(b.dataset.o as OngletId)));

function reserve(): string {
  return `<div class="card"><h2>Connexion chiffrée requise</h2><p>Cette partie donne accès à ta vie privée et au contrôle de la maison : elle n'est ouverte qu'avec <b>Tailscale</b> (réseau privé chiffré), pas sur le Wi-Fi en clair.</p><p class="muted">Installe Tailscale sur le PC et sur ce téléphone (même compte), puis rouvre le lien d'appairage envoyé par Jarvis avec l'adresse commençant par <b>100.</b></p></div>`;
}

function erreurVue(e: unknown): string {
  if (e instanceof ErreurAuth) return `<div class="card"><h2>Accès perdu</h2><p>Ouvre à nouveau le lien d'appairage que Jarvis t'a envoyé (Réglages → Téléphone sur le PC).</p></div>`;
  return `<div class="card"><h2>Oups</h2><p class="refuse">${esc(e instanceof Error ? e.message : e)}</p></div>`;
}

async function ouvrir(id: OngletId): Promise<void> {
  actif = id;
  localStorage.setItem("jv-onglet", id);
  nav.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.o === id));
  zone.innerHTML = "";
  const def = ONGLETS.find((o) => o.id === id)!;
  if (def.complet && niveau === "maison") {
    vue.innerHTML = reserve();
    return;
  }
  vue.innerHTML = `<p class="muted">Chargement…</p>`;
  try {
    await ({ discuter: vueDiscuter, etat: vueEtat, maison: vueMaison, memoire: vueMemoire, journal: vueJournal } as Record<OngletId, () => Promise<void>>)[id]();
  } catch (e) {
    vue.innerHTML = erreurVue(e);
  }
}

// ---------- Discuter ----------

interface Msg { de: "moi" | "jarvis"; texte: string; err?: boolean }
const lireHistorique = (): Msg[] => {
  try {
    return JSON.parse(localStorage.getItem("jv-chat") ?? "[]") as Msg[];
  } catch {
    return [];
  }
};
const ecrireHistorique = (m: Msg[]) => {
  try {
    localStorage.setItem("jv-chat", JSON.stringify(m.slice(-40)));
  } catch {
    // stockage plein ou refusé : on continue sans
  }
};

async function vueDiscuter(): Promise<void> {
  let historique = lireHistorique();
  let lire = localStorage.getItem("jv-lire") === "1";
  const dessin = () => {
    vue.innerHTML = `<div class="chat">${historique.length ? historique.map((m) => `<div class="msg ${m.de}${m.err ? " err" : ""}">${esc(m.texte)}</div>`).join("") : `<p class="muted">Écris à Jarvis comme sur le PC. ${niveau === "maison" ? "Sur le Wi-Fi en clair, je réponds aux questions mais je n'agis pas." : "Je peux agir : maison, musique, mémoire…"}<br>Astuce : le micro du clavier de l'iPhone te permet de dicter.</p>`}</div>`;
    vue.scrollTop = vue.scrollHeight;
  };
  zone.innerHTML = `<div class="compose"><button class="b" id="lire" title="Lire les réponses à voix haute">${lire ? "🔊" : "🔇"}</button><textarea id="saisie" rows="1" placeholder="Écris à Jarvis…" enterkeyhint="send"></textarea><button class="b primary" id="envoi">➤</button></div>`;
  const saisie = zone.querySelector<HTMLTextAreaElement>("#saisie")!;
  const envoi = zone.querySelector<HTMLButtonElement>("#envoi")!;
  zone.querySelector<HTMLButtonElement>("#lire")!.onclick = (ev) => {
    lire = !lire;
    localStorage.setItem("jv-lire", lire ? "1" : "0");
    (ev.target as HTMLElement).textContent = lire ? "🔊" : "🔇";
  };
  saisie.oninput = () => {
    saisie.style.height = "auto";
    saisie.style.height = `${Math.min(120, saisie.scrollHeight)}px`;
  };
  const envoyer = async () => {
    const texte = saisie.value.trim();
    if (!texte || envoi.disabled) return;
    saisie.value = "";
    saisie.style.height = "auto";
    envoi.disabled = true;
    historique.push({ de: "moi", texte });
    historique.push({ de: "jarvis", texte: "…" });
    dessin();
    try {
      const r = await poster("/api/demander", { texte }, 170_000);
      historique[historique.length - 1] = { de: "jarvis", texte: String(r.reponse ?? "") || "C'est fait." };
      if (lire && "speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(String(r.reponse ?? ""));
        u.lang = "fr-FR";
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
    } catch (e) {
      historique[historique.length - 1] = { de: "jarvis", texte: e instanceof ErreurAuth ? "Accès perdu : rouvre le lien d'appairage envoyé par Jarvis." : e instanceof Error ? e.message : String(e), err: true };
    }
    ecrireHistorique(historique);
    envoi.disabled = false;
    dessin();
  };
  envoi.onclick = () => void envoyer();
  saisie.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void envoyer();
    }
  };
  dessin();
}

// ---------- Notifications push ----------

function cleVersOctets(base64: string): Uint8Array {
  const rempli = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const brut = atob(rempli);
  return Uint8Array.from(brut, (c) => c.charCodeAt(0));
}

type EtatNotif = { code: "indisponible" | "https" | "installer" | "inactif" | "refuse" | "actif"; message: string };

/** Où en sont les notifications sur ce téléphone, et que faire ? */
async function etatNotifications(): Promise<EtatNotif> {
  if (niveau !== "chiffre") return { code: "indisponible", message: "Les notifications demandent la connexion chiffrée (Tailscale)." };
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (ios && !standalone) return { code: "installer", message: "Sur iPhone, ajoute d'abord l'appli à l'écran d'accueil (Partager → « Sur l'écran d'accueil »), puis ouvre-la depuis l'icône. iOS 16.4 ou plus." };
  if (!window.isSecureContext) return { code: "https", message: "Les notifications demandent une adresse en https. Active le HTTPS dans Tailscale (console d'administration → DNS), redémarre Jarvis, puis rouvre le nouveau lien d'appairage." };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { code: "indisponible", message: "Ce navigateur ne gère pas les notifications." };
  if (Notification.permission === "denied") return { code: "refuse", message: "Les notifications sont refusées pour Jarvis : réactive-les dans les Réglages de l'iPhone → Notifications → Jarvis." };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? { code: "actif", message: "Les notifications sont activées sur ce téléphone." } : { code: "inactif", message: "Reçois les alertes de Jarvis (surveillance, accords demandés, tâches terminées) même quand l'appli est fermée." };
}

async function activerNotifications(): Promise<string> {
  const permission = await Notification.requestPermission(); // doit venir d'un geste de l'utilisateur
  if (permission !== "granted") return "Notifications refusées.";
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const r = await fetch("/api/push/cle", { credentials: "same-origin" });
  if (!r.ok) throw new Error("Le PC n'accepte pas les notifications sur cette connexion.");
  const { cle } = (await r.json()) as { cle: string };
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleVersOctets(cle) as BufferSource });
  await poster("/api/push/abonner", { subscription: sub.toJSON() });
  return "Notifications activées.";
}

async function desactiverNotifications(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await poster("/api/push/desabonner", { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}

async function carteNotifications(): Promise<string> {
  const e = await etatNotifications();
  const bouton =
    e.code === "inactif" ? `<button class="b primary" data-notif="on">Activer les notifications</button>` : e.code === "actif" ? `<button class="b" data-notif="test">Envoyer un test</button> <button class="b bad" data-notif="off">Désactiver</button>` : "";
  return `<div class="card"><h2>Notifications</h2><p>${esc(e.message)}</p>${bouton}<p class="muted" id="notif-msg"></p></div>`;
}

function brancherNotifications(): void {
  vue.querySelectorAll<HTMLButtonElement>("[data-notif]").forEach((b) => {
    b.onclick = async () => {
      const msg = vue.querySelector<HTMLElement>("#notif-msg");
      b.disabled = true;
      try {
        if (b.dataset.notif === "on") msg!.textContent = await activerNotifications();
        else if (b.dataset.notif === "off") await desactiverNotifications();
        else if (b.dataset.notif === "test") {
          const r = await appel<{ envoyes: number; erreurs: string[] }>("push:tester");
          msg!.textContent = r.envoyes ? "Test envoyé : la notification arrive dans quelques secondes." : `Rien n'est parti${r.erreurs?.length ? ` (${r.erreurs[0]})` : " : aucun téléphone abonné"}.`;
          b.disabled = false;
          return;
        }
        void ouvrir("etat");
      } catch (e) {
        const brut = e instanceof Error ? e.message : String(e);
        // Les messages du navigateur sont en anglais et cryptiques : on explique en français.
        msg!.textContent = /push service|permission denied|AbortError|registration failed/i.test(brut)
          ? "Le téléphone n'a pas pu joindre son service de notifications (réseau, ou permission refusée). Vérifie la connexion et les Réglages de l'iPhone → Notifications → Jarvis, puis réessaie."
          : brut;
        b.disabled = false;
      }
    };
  });
}

// ---------- État ----------

async function vueEtat(): Promise<void> {
  const [cap, cout, forme] = await Promise.allSettled([appel("capacites:lire"), appel("cout:lire"), appel("forme:lire")]);
  let html = "";
  if (cap.status === "fulfilled") {
    const { bilan, liste } = cap.value;
    const manquants = (liste as any[]).filter((c) => c.etat === "a-configurer");
    html += `<div class="card"><h2>Ce que je sais faire</h2><b>${bilan.actives} sur ${bilan.total}</b> fonctions sont prêtes.<div class="bar"><i style="width:${Math.round((bilan.actives / bilan.total) * 100)}%"></i></div>${manquants.length ? `<p class="muted">À régler sur le PC :</p>${manquants.slice(0, 8).map((c) => `<div class="row"><div class="g"><b>${esc(c.titre)}</b><br><span class="muted">${esc(c.manque ?? "")}</span></div></div>`).join("")}` : `<p class="muted">Tout est en place.</p>`}</div>`;
  }
  if (cap.status === "fulfilled" && cap.value.verifs && Object.keys(cap.value.verifs).length) {
    const vs = Object.values(cap.value.verifs) as any[];
    const n = (e: string) => vs.filter((v) => v.etat === e).length;
    const mal = vs.filter((v) => v.etat === "echec" || v.etat === "attention");
    html += `<div class="card"><h2>Dernier test chez toi</h2><p>✅ ${n("ok")} · 🟠 ${n("attention")} · 🔴 ${n("echec")} · ⚪ ${n("ignore")} non configurés</p>${mal.length ? mal.map((v) => `<div class="row"><div class="g"><b>${v.etat === "echec" ? "🔴" : "🟠"} ${esc(v.titre)}</b><br><span class="muted">${esc(v.detail)}</span></div></div>`).join("") : `<p class="muted">Tout ce qui est configuré marche.</p>`}<p class="muted">Pour relancer le test, utilise Réglages sur le PC.</p></div>`;
  }
  if (cout.status === "fulfilled") {
    const c = cout.value;
    html += `<div class="card"><h2>Consommation de Claude</h2><div class="tiles"><div class="tile"><div class="v">${c.resume.aujourdhui.appels}</div>appels aujourd'hui</div><div class="tile"><div class="v">${Number(c.resume.aujourdhui.usd).toFixed(2)}<small>$</small></div>équivalent du jour</div></div>${c.plafond ? `<div class="bar"><i style="width:${Math.min(100, Math.round((c.resume.aujourdhui.usd / c.plafond) * 100))}%"></i></div><p class="muted">Plafond : ${Number(c.plafond).toFixed(2)} $</p>` : ""}</div>`;
  }
  if (forme.status === "fulfilled") {
    const m = forme.value.resume as any[];
    html += `<div class="card"><h2>Ma forme</h2>${m.length ? `<div class="tiles">${m.map((x) => `<div class="tile"><div class="v">${esc(x.valeur)}<small>${esc(x.unite)}</small></div>${esc(x.libelle)}</div>`).join("")}</div>` : `<p class="muted">Aucune donnée de ta montre pour l'instant.</p>`}</div>`;
  }
  const carteNotif = await carteNotifications().catch(() => "");
  vue.innerHTML = `${carteNotif}${html || erreurVue("Rien à afficher.")}<p style="text-align:center"><button class="b" id="maj">Actualiser</button></p>`;
  vue.querySelector<HTMLButtonElement>("#maj")!.onclick = () => void ouvrir("etat");
  brancherNotifications();
}

// ---------- Maison ----------

async function vueMaison(): Promise<void> {
  const [acc, sec, mus] = await Promise.allSettled([appel("page:data", "accueil"), appel("page:data", "securite"), appel("musique:etat")]);
  let html = "";
  if (acc.status === "fulfilled") {
    const devices = (acc.value.devices ?? []) as Array<{ nom: string; type: string; allume: boolean | null; luminosite?: number }>;
    html += `<div class="card"><h2>Lumières et prises</h2>${devices.length ? devices.map((d, i) => `<div class="row"><span>${d.type === "prise" ? "🔌" : "💡"}</span><div class="g">${esc(d.nom)}${d.allume && d.luminosite ? ` <span class="muted">${d.luminosite} %</span>` : ""}</div><div class="switch${d.allume ? " on" : ""}" data-d="${i}"></div></div>`).join("") : `<p class="muted">Aucun appareil connecté.</p>`}</div>`;
    setTimeout(() => {
      vue.querySelectorAll<HTMLElement>("[data-d]").forEach((s) => {
        const d = devices[Number(s.dataset.d)]!;
        s.onclick = async () => {
          s.classList.toggle("on");
          try {
            await appel("tapo:toggle", { nom: d.nom, allume: !d.allume });
          } finally {
            void ouvrir("maison");
          }
        };
      });
    });
  }
  if (sec.status === "fulfilled" && sec.value.configure) {
    const mode = sec.value.mode as string;
    html += `<div class="card"><h2>Surveillance</h2><div class="seg">${[["off", "Désactivée"], ["simple", "Simple"], ["complete", "Complète"]].map(([m, l]) => `<button class="b${mode === m ? " on" : ""}" data-m="${m}">${l}</button>`).join("")}</div><p class="muted">Complète : dissuasion (lumières, message) et alertes avec photo.</p></div>`;
    setTimeout(() => {
      vue.querySelectorAll<HTMLButtonElement>("[data-m]").forEach((b) => {
        b.onclick = async () => {
          if (b.dataset.m === "complete" && !confirm("Activer la surveillance complète (dissuasion et alertes) ?")) return;
          await appel("securite:mode", b.dataset.m).catch((e) => alert(e.message));
          void ouvrir("maison");
        };
      });
    });
  }
  if (mus.status === "fulfilled" && mus.value.relie) {
    const m = mus.value;
    html += `<div class="card"><h2>Musique</h2><p>${m.titre ? `<b>${esc(m.titre)}</b><br><span class="muted">${esc(m.artistes ?? "")}</span>` : `<span class="muted">Rien en lecture.</span>`}</p><div class="seg"><button class="b" data-c="precedent">⏮</button><button class="b" data-c="${m.enLecture ? "pause" : "lecture"}">${m.enLecture ? "⏸" : "▶"}</button><button class="b" data-c="suivant">⏭</button></div></div>`;
    setTimeout(() => {
      vue.querySelectorAll<HTMLButtonElement>("[data-c]").forEach((b) => {
        b.onclick = async () => {
          b.disabled = true;
          await appel("musique:commande", { action: b.dataset.c }).catch(() => undefined);
          void ouvrir("maison");
        };
      });
    });
  }
  vue.innerHTML = html || erreurVue("Rien à afficher.");
  // Les liaisons ci-dessus s'exécutent après l'affichage (setTimeout 0).
}

// ---------- Mémoire ----------

async function vueMemoire(): Promise<void> {
  const [mem, idees, rang] = await Promise.all([appel("memoire:lire"), appel("ameliorations:lire").catch(() => ({ propositions: [] })), appel("rangement:lire").catch(() => ({ propositions: [] }))]);
  const rangs = (rang.propositions as any[]).filter((p) => p.etat === "proposee");
  const faits = mem.faits as Array<{ id: string; fait: string }>;
  const rappels = (mem.rappels ?? []) as Array<{ cle: string; texte: string; instant: string; avis?: string }>;
  const ouvertes = (idees.propositions as any[]).filter((p) => p.etat === "proposee");
  vue.innerHTML = `
    ${rangs.length ? `<div class="card"><h2>Rangement de la mémoire</h2>${rangs.map((p) => `<div class="row"><div class="g"><b>${p.type === "fusion" ? "Fusionner" : "Oublier"}</b> : ${p.concernes.map((c: string) => `« ${esc(c)} »`).join(" + ")}${p.type === "fusion" ? `<br>→ « ${esc(p.texte ?? "")} »` : ""}<br><span class="muted">${esc(p.pourquoi)}</span></div><div><button class="b small" data-rok="${esc(p.id)}">Oui</button> <button class="b small" data-rno="${esc(p.id)}">Non</button></div></div>`).join("")}</div>` : ""}
    ${ouvertes.length ? `<div class="card"><h2>Idées d'amélioration</h2>${ouvertes.map((p) => `<div class="row"><div class="g"><b>${esc(p.titre)}</b><br>${esc(p.regle)}<br><span class="muted">${esc(p.pourquoi)}</span></div><div><button class="b small" data-ok="${esc(p.id)}">Oui</button> <button class="b small" data-non="${esc(p.id)}">Non</button></div></div>`).join("")}</div>` : ""}
    <div class="card"><h2>Ce que Jarvis a ressorti</h2>${rappels.length ? rappels.map((r) => `<div class="row"><div class="g">${esc(r.texte)}<br><span class="muted">${jour(r.instant)} ${heure(r.instant)}</span></div><div><button class="b small${r.avis === "utile" ? " primary" : ""}" data-u="${esc(r.cle)}">👍</button> <button class="b small${r.avis === "inutile" ? " primary" : ""}" data-i="${esc(r.cle)}">👎</button></div></div>`).join("") : `<p class="muted">Rien pour l'instant.</p>`}</div>
    <div class="card"><h2>Ajouter un souvenir</h2><textarea class="t" id="nouveau" rows="2" placeholder="ex. Je préfère le café sans sucre."></textarea><button class="b primary" id="ajout">Retenir</button></div>
    <div class="card"><h2>Ce que je sais de toi (${faits.length})</h2>${faits.length ? faits.map((f) => `<div class="row"><div class="g">${esc(f.fait)}</div><button class="b small bad" data-f="${esc(f.id)}">Oublier</button></div>`).join("") : `<p class="muted">Rien pour l'instant.</p>`}</div>`;
  const recharger = () => void ouvrir("memoire");
  const sur = (sel: string, fn: (v: string) => Promise<unknown>, attr: string) => vue.querySelectorAll<HTMLElement>(sel).forEach((b) => (b.onclick = async () => (await fn(b.getAttribute(attr)!).catch((e) => alert(e.message)), recharger())));
  sur("[data-rok]", (id) => appel("rangement:decider", { id, accepte: true }), "data-rok");
  sur("[data-rno]", (id) => appel("rangement:decider", { id, accepte: false }), "data-rno");
  sur("[data-ok]", (id) => appel("ameliorations:decider", { id, accepte: true }), "data-ok");
  sur("[data-non]", (id) => appel("ameliorations:decider", { id, accepte: false }), "data-non");
  sur("[data-u]", (cle) => appel("rappel:retour", { cle, avis: "utile" }), "data-u");
  sur("[data-i]", (cle) => appel("rappel:retour", { cle, avis: "inutile" }), "data-i");
  vue.querySelectorAll<HTMLElement>("[data-f]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Oublier ce souvenir ?")) return;
      await appel("memoire:oublier", b.dataset.f).catch((e) => alert(e.message));
      recharger();
    };
  });
  vue.querySelector<HTMLButtonElement>("#ajout")!.onclick = async () => {
    const box = vue.querySelector<HTMLTextAreaElement>("#nouveau")!;
    if (!box.value.trim()) return;
    await appel("memoire:ajouter", box.value.trim()).catch((e) => alert(e.message));
    recharger();
  };
}

// ---------- Journal ----------

async function vueJournal(): Promise<void> {
  const j = await appel("journal:lire");
  const entrees = (j.entrees ?? []) as Array<{ t: string; outil: string; resume: string; autorise: boolean; raison?: string; origine?: string }>;
  vue.innerHTML = `${j.enPanne?.length ? `<div class="banner">En panne : ${esc(j.enPanne.join(", "))}</div>` : ""}<div class="card"><h2>Ce que j'ai fait</h2>${entrees.length ? entrees.slice(0, 60).map((e) => `<div class="row${e.autorise ? "" : " refuse"}"><div class="g"><span class="muted">${heure(e.t)} · ${esc(e.outil)}</span><br>${esc(e.resume)}${e.raison ? `<br><em class="muted">${esc(e.raison)}</em>` : ""}</div></div>`).join("") : `<p class="muted">Rien pour l'instant.</p>`}</div><p style="text-align:center"><button class="b" id="maj">Actualiser</button></p>`;
  vue.querySelector<HTMLButtonElement>("#maj")!.onclick = () => void ouvrir("journal");
}

// ---------- Demandes d'accord (actions sensibles) ----------

async function rafraichirApprobations(): Promise<void> {
  const zoneAp = document.getElementById("approbations");
  if (!zoneAp || niveau !== "chiffre") return;
  try {
    const r = await appel<{ attente: Array<{ id: string; outil: string; resume: string; origine: string; expireLe: string }> }>("approbations:lister");
    zoneAp.innerHTML = r.attente
      .map((d) => `<div class="banner"><b>🔐 Jarvis demande ton accord</b> <span class="muted">(${esc(d.origine)})</span><br><b>${esc(d.outil)}</b><br><span style="overflow-wrap:anywhere">${esc(d.resume)}</span><div class="seg" style="margin-top:8px"><button class="b primary" data-ap="${esc(d.id)}" data-v="1">Approuver</button><button class="b bad" data-ap="${esc(d.id)}" data-v="0">Refuser</button></div><small class="muted">Sans réponse avant ${heure(d.expireLe)}, c'est refusé.</small></div>`)
      .join("");
    zoneAp.querySelectorAll<HTMLButtonElement>("[data-ap]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        await appel("approbations:repondre", { id: b.dataset.ap, accepte: b.dataset.v === "1" }).catch(() => undefined);
        void rafraichirApprobations();
      };
    });
  } catch {
    // injoignable : on réessaiera au prochain tour
  }
}

// ---------- Démarrage ----------

async function demarrer(): Promise<void> {
  const badge = document.getElementById("badge")!;
  const bandeau = document.getElementById("bandeau")!;
  try {
    const r = await fetch("/api/etat", { credentials: "same-origin" });
    if (r.status === 401) throw new ErreurAuth("auth");
    niveau = ((await r.json()) as { niveau: Niveau }).niveau;
  } catch (e) {
    badge.textContent = "hors ligne";
    badge.className = "badge warn";
    vue.innerHTML = e instanceof ErreurAuth ? erreurVue(e) : `<div class="card"><h2>PC injoignable</h2><p>Le téléphone n'arrive pas à joindre Jarvis. Le PC est-il allumé, et es-tu sur le même Wi-Fi (ou connecté à Tailscale) ?</p><button class="b primary" onclick="location.reload()">Réessayer</button></div>`;
    return;
  }
  badge.textContent = niveau === "chiffre" ? "🔒 chiffré" : "Wi-Fi · lecture limitée";
  badge.className = `badge ${niveau === "chiffre" ? "ok" : "warn"}`;
  const installee = (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
  bandeau.innerHTML =
    (niveau === "maison" ? `<div class="banner">Connexion non chiffrée (Wi-Fi de la maison) : je réponds aux questions, mais la maison, la mémoire et le journal restent verrouillés. Installe Tailscale pour tout contrôler.</div>` : "") +
    (!installee && !localStorage.getItem("jv-astuce") ? `<div class="banner info" id="astuce">Pour l'installer comme une appli : bouton Partager de Safari → « Sur l'écran d'accueil ». <u>OK</u></div>` : "");
  document.getElementById("astuce")?.addEventListener("click", () => {
    localStorage.setItem("jv-astuce", "1");
    document.getElementById("astuce")?.remove();
  });
  await ouvrir(actif);
  void rafraichirApprobations();
  setInterval(() => document.visibilityState === "visible" && void rafraichirApprobations(), 5000);
}

void demarrer();
