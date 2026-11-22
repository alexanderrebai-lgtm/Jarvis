# Jarvis sur ton téléphone (Jarvis Mobile)

Une application web que ton PC sert et que ton téléphone ajoute à son écran
d'accueil. Elle s'ouvre comme une appli et parle au **même Jarvis** que sur le
PC : mêmes données, même mémoire, même journal.

## Ce que tu peux faire depuis le téléphone

| Onglet | Quoi |
| --- | --- |
| **Discuter** | Écrire à Jarvis comme sur le PC (il peut agir : maison, musique, mémoire…). Tu peux dicter avec le micro du clavier de l'iPhone, et activer la lecture à voix haute des réponses. |
| **État** | Ce qui est prêt chez toi et ce qui manque, la consommation de Claude du jour, ta forme (montre). |
| **Maison** | Allumer / éteindre lumières et prises, armer la surveillance, piloter la musique. |
| **Mémoire** | Ce que Jarvis sait de toi (ajouter, oublier), ce qu'il t'a rappelé (👍/👎), ses idées d'amélioration (accepter / refuser). |
| **Journal** | Ce que Jarvis a fait, ce qu'il a refusé, ce qui est en panne. |

## Ce que tu ne peux PAS faire depuis le téléphone (volontairement)

Les **réglages** (mots de passe, jetons, comptes), la **création de connecteurs**
(qui peuvent lancer des programmes sur le PC), les actions système du PC
(optimisation, fermeture de programmes) restent **sur le PC**. Raison : si ton
téléphone est volé, ou si le lien fuite, il ne doit pas donner la main sur ton
ordinateur. Chaque action faite depuis le téléphone est notée dans le Journal.

## Installation (une seule fois)

1. **Tailscale** sur le PC et sur le téléphone, avec le **même compte** (gratuit).
   C'est ce qui donne le contrôle complet, de chez toi comme de dehors, en
   connexion chiffrée.
2. Dans Jarvis (PC) : **Réglages → Téléphone (Jarvis Mobile)** → « Activer » = Oui
   → Enregistrer.
3. Clique sur **« Envoyer le lien sur Telegram »** (ou « Voir le lien d'appairage »
   et envoie-le toi autrement).
4. Sur le téléphone, **ouvre le lien** (une seule fois). L'application s'ouvre.
5. Sur iPhone : bouton **Partager** de Safari → **« Sur l'écran d'accueil »**. Tu
   as maintenant l'icône Jarvis.

Si le lien ne s'ouvre pas : le PC est-il allumé, Tailscale est-il actif sur le
téléphone ? Jarvis revérifie les adresses toute les minutes.

## Les deux niveaux de connexion

- **Chiffré (Tailscale)** : contrôle complet (tous les onglets).
- **Wi-Fi de la maison, sans Tailscale** (option « Accepter aussi le Wi-Fi »,
  désactivée par défaut) : **lecture limitée et questions seulement**. Le
  Wi-Fi n'est pas chiffré pour cette application : quelqu'un sur le même réseau
  pourrait intercepter la connexion. Donc ni maison, ni mémoire, ni journal, et
  Jarvis traite tes messages comme ceux d'une voix inconnue (il répond, il
  n'agit pas).

## Sécurité en bref

- Un jeton long, échangé contre un cookie ; il disparaît de l'adresse aussitôt.
- Huit essais ratés : la porte se ferme une minute.
- **« Renouveler le jeton »** (Réglages → Téléphone) déconnecte tous les
  téléphones : à faire si tu perds un téléphone ou si le lien a été partagé.
- Le lien envoyé par Telegram transite par les serveurs de Telegram : ne le
  transfère à personne, et renouvelle le jeton en cas de doute.

## Répondre à Jarvis par Telegram (texte et messages vocaux)

En plus de l'application, tu peux écrire — ou envoyer un **message vocal** — à ton
bot Telegram : Jarvis répond. Ça marche de n'importe où, **sans Tailscale**.

1. Réglages → **Alertes sur le téléphone (Telegram)** : renseigne le bot comme avant.
2. Mets « Pouvoir lui répondre par Telegram » sur **Oui**, enregistre.
3. Écris-lui, ou tiens le micro de Telegram et parle. Les vocaux sont **transcrits
   sur ton PC** (Whisper) ; Jarvis te dit d'abord ce qu'il a compris.

Sécurité : seule **ta** conversation privée avec le bot est écoutée, tout le reste
est ignoré. Les vieux messages (Jarvis éteint) ne sont pas exécutés d'un coup.
Par défaut, Telegram est en **« questions seulement »** : si ton compte était piraté
(échange de carte SIM), il ne doit pas donner la main sur ton PC. « Agir comme toi »
est un choix explicite ; pour tout piloter, préfère Jarvis Mobile avec Tailscale.

Un seul programme peut lire un bot à la fois : si le serveur Jarvis (version
téléphone/serveur) utilise le même bot, Jarvis Windows signale un conflit.

## Limites actuelles

- Pas de notifications push sur le téléphone (elles demandent HTTPS et une
  installation plus lourde) : les alertes de la surveillance continuent d'arriver
  par **Telegram**.
- Le PC doit être **allumé** et Jarvis lancé.
- Pas de conversation vocale en continu depuis l'appli : dicte avec le clavier, ou envoie un vocal par Telegram.
- Je l'ai testé avec un iPhone **émulé** sur un PC de test (appairage, onglets,
  refus de sécurité), pas sur ton vrai téléphone. Dis-moi ce qui coince.
