# Jarvis : ton assistant personnel IA

Jarvis est un petit serveur, allumé en permanence, qui donne à Claude des outils à toi : notes et rappels, mémoire durable, SMS reçus, Gmail, Google Agenda, navigateur web pour réserver, et calculs exacts pour décider.

## Deux façons de l'utiliser (cumulables)

| | **Mode abonnement** (recommandé) | **Mode automatique** (facultatif) |
|---|---|---|
| Comment tu lui parles | Dans l'app **Claude** sur iPhone (texte ou voix) | **Telegram** et **« Dis Siri, Jarvis »** |
| Qui paie la réflexion | Ton **abonnement Claude**, sans coût par question | La **clé API**, facturée à l'usage |
| Il agit sans que tu demandes | Non | Oui : tri des mails, briefing du matin, rappels |
| À configurer | Le serveur + un connecteur dans Claude | En plus : clé API + bot Telegram |

**Pourquoi l'abonnement ne peut pas servir au mode automatique.** Les règles d'Anthropic réservent la connexion par abonnement (Pro, Max) aux applications d'Anthropic. Un programme qui tourne seul et utilise ce compte est interdit, et le compte peut être bloqué sans préavis. La voie autorisée, c'est l'inverse : l'app Claude, payée par ton abonnement, se branche sur Jarvis comme **connecteur personnalisé**. C'est le mode abonnement.

## Ce que Jarvis fait

| Domaine | Ce qu'il fait |
|---|---|
| **Ampoules et prises Tapo** | Allume, éteint, règle la luminosité et la couleur, pilote une pièce ou toute la maison, donne la consommation des prises qui la mesurent. Directement sur ton Wi-Fi, sans boîtier |
| **Autres objets connectés** | Allume, éteint, règle le chauffage, les volets, la musique, lance l'aspirateur, lit les capteurs : toutes marques via Home Assistant. Serrures, alarme et garage seulement avec ton accord |
| **Réservations en ligne** | Ouvre les vrais sites (restaurant, coiffeur, médecin, train, activité), cherche un créneau, remplit le formulaire, puis te demande ton « oui » avant le clic final |
| **Mails (Gmail)** | Cherche, lit, résume, prépare les réponses (envoi après ton accord), range |
| **Agenda (Google)** | Consulte, trouve des créneaux libres, crée, déplace et supprime des rendez-vous |
| **SMS reçus** | Ton iPhone lui transmet les SMS des contacts choisis (raccourci) ; tu peux demander « qu'est-ce que Léa m'a écrit ? » |
| **Notes, rappels, mémoire** | Retient ce que tu lui confies et s'en sert ensuite |
| **Avis et décisions** | Cherche les faits sur le web, chiffre les probabilités, le gain moyen et la faisabilité, puis donne un avis franc |
| **En mode automatique** | Signale chaque mail important avec une réponse prête, envoie le briefing du matin, rappelle tes rendez-vous |

L'app Claude sur iPhone ajoute ses propres accès à iOS : elle crée des rendez-vous dans **Calendrier**, ajoute des **Rappels**, rédige des messages qu'elle ouvre dans **Messages** ou WhatsApp pour que tu les envoies, et montre des lieux dans **Plans** ([aide Claude](https://support.claude.com/en/articles/11869619-use-claude-with-ios-apps)). Avec Jarvis en plus, tu as donc tout au même endroit.

### Ce qui reste impossible

- **Lire tes SMS, iMessage ou WhatsApp directement.** Ni l'app Claude ni aucune autre appli ne le peut : iOS l'interdit. L'automatisation Raccourcis pour les SMS est la seule voie autorisée. WhatsApp et Instagram se partagent à la main.
- **Passer les CAPTCHA, les codes SMS de connexion ou les protections anti-robots.** Jarvis s'arrête, te le dit et te donne le lien. Contourner ces protections enfreint les conditions des sites et peut faire bannir ton compte.
- **Saisir ta carte bancaire.** Jarvis prépare la réservation jusqu'au paiement, puis tu termines toi-même. C'est volontaire : une IA qui paie seule peut être piégée par une page malveillante.

### Exemples

- « Éteins toutes les lumières sauf la chambre, et mets-la à 20 % en blanc chaud. »
- « Combien a consommé la prise de la télé aujourd'hui ? »
- « Baisse le chauffage de la chambre à 18 et éteins tout au salon. »
- « Il fait combien dehors ? Ferme les volets si ça descend sous 5 degrés. »
- « Réserve-moi une table pour 4 samedi soir vers 20 h dans un italien près de Bellecour. »
- « Trouve un créneau chez un coiffeur près de chez moi jeudi après 18 h. »
- « Qu'est-ce que Léa m'a écrit ce matin ? Prépare-lui une réponse. »
- « J'hésite entre l'offre A à 2 400 € avec 1 h de trajet et l'offre B à 2 150 € en télétravail. Ton avis ? »
- « J'ouvre un food truck à Lyon : quelles sont mes chances que ça marche la première année ? »

**Sécurité :** aucun mail ne part, aucun rendez-vous n'est supprimé et aucune réservation n'est validée sans ton accord explicite. Le contenu des mails, des SMS et des pages web est traité comme une information, jamais comme un ordre.

## Installation

Il te faut un ordinateur pour l'installation, puis un serveur toujours allumé avec une adresse HTTPS.

### 1. Le serveur

Choisis une de ces solutions :

- **Railway ou Fly.io** (le plus simple) : déploie le `Dockerfile`, ajoute un volume monté sur `/data`. Tu obtiens une adresse HTTPS automatiquement.
- **Un petit serveur en ligne** (Hetzner, OVH, Scaleway : environ 5 € par mois) :
  ```bash
  docker build -f apps/jarvis/Dockerfile -t jarvis .
  docker run -d --restart unless-stopped --env-file apps/jarvis/.env -v jarvis-data:/data -p 8787:8787 jarvis
  ```
  Mets [Caddy](https://caddyserver.com) devant le port 8787 pour l'adresse HTTPS.
- **Un vieil ordinateur ou un Raspberry Pi chez toi**, avec un [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) pour l'adresse HTTPS.

Copie `.env.example` vers `.env`. Remplis `OWNER_NAME` et `WEBHOOK_SECRET`, une longue suite aléatoire, par exemple le résultat de `openssl rand -hex 24`.

Pour essayer sur ton ordinateur : `pnpm install` à la racine du dépôt, puis `pnpm start` dans `apps/jarvis`.

### 2. Brancher Jarvis dans l'app Claude (mode abonnement)

1. Sur [claude.ai](https://claude.ai), depuis un navigateur d'ordinateur : **Personnaliser → Connecteurs → +** puis **Ajouter un connecteur personnalisé**.
2. Nom : `Jarvis`. Adresse : `https://ton-serveur.exemple.fr/mcp/WEBHOOK_SECRET`, en remplaçant `WEBHOOK_SECRET` par ta valeur. Pas de connexion à configurer.
3. Ouvre l'app Claude sur ton iPhone : le connecteur y est disponible. Active-le dans une conversation avec le bouton des outils.
4. Pour ne pas répéter les règles, ajoute dans **Réglages → Profil**, rubrique des préférences personnelles : « Tu es Jarvis, mon assistant. Utilise le connecteur Jarvis pour mes notes, ma mémoire, mes SMS, mes réservations et mes calculs de décision. »

Garde cette adresse secrète : elle donne accès à tes notes et à ton navigateur. Si elle fuit, change `WEBHOOK_SECRET` et mets le connecteur à jour.

**Mails et agenda sans configurer Google Cloud :** Claude propose aussi ses propres connecteurs **Gmail** et **Google Agenda** dans **Connecteurs**. En mode abonnement, tu peux utiliser ceux-là et sauter l'étape 3.

### 3. Google (Gmail + Agenda par Jarvis)

Cette étape est nécessaire pour le mode automatique, et facultative sinon.

1. Va sur [console.cloud.google.com](https://console.cloud.google.com) et crée un projet « Jarvis ».
2. Dans *API et services → Bibliothèque*, active **Gmail API** et **Google Calendar API**.
3. Dans *Écran de consentement OAuth* : type « Externe », ajoute ton adresse comme utilisateur test. Ensuite, clique sur **Publier l'application** : sinon Google déconnecte Jarvis tous les 7 jours. L'avertissement « appli non validée » est normal pour un usage personnel.
4. Dans *Identifiants → Créer → ID client OAuth*, choisis le type **Application de bureau**. Copie l'ID et le secret dans `.env`.
5. Sur ton ordinateur, lance `pnpm google-auth` dans `apps/jarvis`, accepte, puis colle la ligne `GOOGLE_REFRESH_TOKEN=…` dans `.env`.

### 4. Ampoules et prises Tapo (facultatif)

Jarvis commande tes Tapo (ampoules L510, L530, L535…, prises P100, P105, P110, P115…) **directement sur ton Wi-Fi**, sans Home Assistant. Il doit donc tourner **chez toi**, sur le même réseau que les appareils :

- **Sur un ordinateur de la maison** qui reste allumé (vieux PC, Mac, Raspberry Pi 4 ou 5). Pour que l'app Claude le joigne depuis l'extérieur, installe un [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (gratuit) : il te donne une adresse `https://…` sans ouvrir de port sur ta box.

Ensuite :

1. Mets l'adresse e-mail et le mot de passe de ton **appli Tapo** dans `TAPO_EMAIL` et `TAPO_PASSWORD`.
2. Donne des noms clairs à tes appareils dans l'appli Tapo (« Lampe salon », « Prise télé ») : c'est par ces noms que tu les appelleras.
3. Conseillé : dans l'interface de ta box (Freebox, Livebox, SFR, Bouygues), réserve une **adresse IP fixe** pour chaque appareil Tapo, puis liste-les dans `TAPO_DEVICES`, par exemple `Lampe salon=192.168.1.20,Prise télé=192.168.1.21`. Sans cette liste, Jarvis retrouve les appareils par ton compte Tapo, mais c'est moins fiable.
4. Si un appareil reste « injoignable », ouvre l'appli Tapo : *Moi → Services tiers*, et active la **compatibilité avec les services tiers** si l'option existe. Les firmwares récents bloquent sinon le contrôle local. Vérifie aussi que l'appareil et l'ordinateur sont sur le même réseau Wi-Fi (pas le réseau invité).

Avec Docker sur Linux, ajoute `--network host` à la commande `docker run` pour que Jarvis voie les appareils du réseau local.

### 5. Autres objets connectés : Home Assistant (facultatif)

Pour les autres marques, Jarvis pilote tes objets par **Home Assistant**, un logiciel gratuit qui relie plus de 2 000 marques : Philips Hue, IKEA, Xiaomi, Tuya et Smart Life (la plupart des prises et ampoules premier prix), Google Nest, Netatmo, Somfy, Sonos, Shelly, Roborock, Ecovacs, Daikin… Tes objets n'ont pas besoin d'être compatibles Apple.

1. **Installe Home Assistant** chez toi, sur un boîtier [Home Assistant Green](https://www.home-assistant.io/green/) (environ 100 €, prêt à brancher), un Raspberry Pi 4 ou 5, ou un vieil ordinateur.
2. **Ajoute tes marques** dans *Paramètres → Appareils et services → Ajouter une intégration*. Cherche le nom de la marque ou de son appli, par exemple « Smart Life » ou « Xiaomi Home ». Connecte-toi avec le compte de l'appli habituelle. Donne des noms clairs à tes appareils (« Lumière salon », « Radiateur chambre ») : Jarvis s'en sert pour comprendre ce que tu demandes.
3. **Crée un jeton** : clique sur ton profil (en bas à gauche), puis *Sécurité → Jetons d'accès longue durée → Créer*. Colle-le dans `HOME_ASSISTANT_TOKEN`.
4. **Indique l'adresse** dans `HOME_ASSISTANT_URL` :
   - Le plus simple : fais tourner **Jarvis chez toi, sur la même machine** que Home Assistant (Docker ou un ordinateur allumé), et mets `http://homeassistant.local:8123`. Il faut alors un [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) pour que l'app Claude atteigne Jarvis.
   - Si Jarvis est sur un serveur en ligne, Home Assistant doit être joignable depuis Internet. Avec [Home Assistant Cloud](https://www.nabucasa.com) (environ 7,50 € par mois, aucune configuration), l'adresse ressemble à `https://xxxx.ui.nabu.casa`. Un Cloudflare Tunnel est une alternative gratuite.

### 6. Mode automatique (facultatif)

1. Crée une clé sur [console.anthropic.com](https://console.anthropic.com) et **fixe une limite de dépense mensuelle**. Colle-la dans `ANTHROPIC_API_KEY`. Une question simple coûte quelques centimes. `ANTHROPIC_MODEL=claude-sonnet-5-5` divise environ le coût par deux.
2. Dans Telegram, ouvre **@BotFather**, envoie `/newbot` et colle le jeton dans `TELEGRAM_BOT_TOKEN`.
3. Relance Jarvis et écris à ton bot. Il te donne ton `TELEGRAM_CHAT_ID` : ajoute-le dans `.env` puis relance.

Commandes Telegram : `/briefing` (le point du jour), `/notes` (tes dernières notes), `/nouveau` (repartir d'une conversation vierge ; la mémoire reste).

## Raccourcis iPhone

Dans les exemples, `https://ton-serveur.exemple.fr` est ton adresse et `SECRET` la valeur de `WEBHOOK_SECRET`.

### SMS et iMessage reçus (les deux modes)

Dans **Raccourcis → Automatisation → Nouvelle automatisation → Message** :

1. Choisis les expéditeurs à surveiller. Selon ta version d'iOS, tu peux aussi filtrer par mot-clé.
2. Coche **Exécuter immédiatement**.
3. Action **Obtenir le contenu de l'URL** : `https://ton-serveur.exemple.fr/message`, méthode **POST**, en-tête `Authorization` = `Bearer SECRET`, corps **JSON** :
   - `de` = *Entrée du raccourci → Expéditeur*
   - `contenu` = *Entrée du raccourci → Contenu*
   - `app` = `SMS`

En mode abonnement, demande ensuite à Claude « qu'est-ce que j'ai reçu ? ». En mode automatique, Jarvis t'alerte dans Telegram si c'est important ou suspect, avec une réponse proposée.

### WhatsApp, Instagram, Messenger : partager à Jarvis

Crée un raccourci **Envoyer à Jarvis**, activé dans la **feuille de partage**, qui accepte du **texte**. Il appelle `/message` comme ci-dessus, avec `app` = `WhatsApp` et `contenu` = *Entrée du raccourci*. Dans WhatsApp, appuie longuement sur un message, puis choisis *Partager → Envoyer à Jarvis*.

### « Dis Siri, Jarvis » (mode automatique)

Crée un raccourci **Jarvis** avec quatre actions :

1. **Dicter le texte**
2. **Obtenir le contenu de l'URL** : `/demander`, POST, même en-tête, JSON `texte` = *Texte dicté*
3. **Obtenir la valeur du dictionnaire** `reponse`
4. **Énoncer le texte**

En mode abonnement, utilise plutôt le mode vocal de l'app Claude.

## Fonctionnement technique

```
src/mcp.ts          Connecteur pour l'app Claude (MCP, sans état, protégé par le secret)
src/browser.ts      Navigateur Chromium piloté (Playwright) avec garde-fous
src/agent.ts        Mode automatique : boucle avec Claude (outils, recherche web, historique)
src/tools.ts        Outils partagés : mails, agenda, notes, mémoire, SMS, navigateur, calculs
src/decision.ts     Calculs exacts : espérance et risque, matrice pondérée, Monte-Carlo
src/triage.ts       Tri des messages reçus et réponse proposée (mode automatique)
src/google/         Gmail et Google Agenda
src/inbox.ts        SMS et messages transmis par l'iPhone
src/tapo.ts         Ampoules et prises Tapo, en local (bibliothèque tp-link-tapo-connect)
src/home.ts         Maison connectée via l'API de Home Assistant
src/telegram.ts     Bot Telegram et boutons de confirmation
src/server.ts       Routes HTTP : /mcp, /message, /demander, /sante
src/watchers.ts     Automatismes : nouveaux mails, briefing, rappels, rendez-vous
data/               Notes, mémoire, messages, profil du navigateur (jamais versionnés)
```

- Garde-fous du navigateur : un clic sur « réserver », « payer », « commander » ou « confirmer » est refusé tant que l'accord n'est pas donné, aucun numéro de carte n'est saisi, et les adresses du réseau local sont bloquées.
- En mode automatique : modèle `claude-opus-5-5`, avec recherche et lecture web côté serveur et relance automatique sur un modèle de secours en cas de refus (`fallbacks: "default"`).
- Tests : `pnpm test` (les tests du navigateur sont ignorés si Chromium n'est pas installé). Types : `pnpm typecheck`.
