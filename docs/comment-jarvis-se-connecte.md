# Comment Jarvis accède aux systèmes — la réalité face à Iron Man

Document de référence du projet. Il compare ce que fait le J.A.R.V.I.S. des films
avec ce qui est possible, légal et souhaitable dans la vraie vie, et explique la
marche à suivre pour que Jarvis pilote un nouvel appareil.

## Le principe de base

Chaque système sérieux (une ampoule, une imprimante, une voiture, un agenda)
expose une **porte d'entrée officielle**, appelée API : une liste d'actions
autorisées (« allumer », « lire la température », « verrouiller »). Pour s'en
servir, il faut une **clé** (jeton, mot de passe, autorisation que le
propriétaire a validée).

Jarvis fait toujours trois choses, dans cet ordre :

1. il se branche sur la porte officielle,
2. il présente la clé que **tu** lui as donnée,
3. il envoie une action de la liste autorisée.

Il ne force jamais une serrure. C'est le contraire exact du Jarvis du film qui
« pirate » tout.

## Les quatre façons de se brancher

| Méthode | Exemple chez nous | Avantage |
| --- | --- | --- |
| **Réseau local** (même Wi-Fi que le PC) | Ampoules Tapo, prise OBD de la voiture | Rapide, rien ne sort de la maison |
| **Service en ligne** (le « cloud » de la marque) | Google, Spotify, Telegram | Marche hors de la maison |
| **Connecteur MCP** (norme universelle) | Réglages → Connecteurs | Brancher un système **sans nouvelle version de Jarvis** |
| **Pont central Home Assistant** | un seul connecteur → toute la maison | Des centaines d'appareils d'un coup |

Le plus puissant est le **connecteur MCP** : n'importe quel système qui offre un
connecteur MCP se branche depuis les Réglages. Et **Home Assistant** est le
« cerveau de la maison » qui parle déjà à des milliers d'appareils ; branché une
fois à Jarvis, il lui ouvre tout.

## La marche à suivre pour un nouvel appareil

1. **Vérifier qu'il a une porte officielle** : chercher « *nom de l'appareil* API »
   ou « *nom de l'appareil* Home Assistant ». Pas d'API → on ne peut pas, et
   c'est normal (c'est une protection).
2. **Préférer le réseau local** quand c'est possible (vitesse, vie privée).
3. **Récupérer la clé** proprement sur le site ou l'appli de la marque, et la
   ranger dans le coffre-fort de Jarvis.
4. **Brancher**, le plus souvent par un connecteur MCP ; sinon, un petit pont
   dédié dans le code (comme pour Tapo).
5. **Tester** (bouton « Tester »), et chaque action est notée dans le Journal.

## La voiture

C'est une bonne illustration, parce que les deux méthodes coexistent.

- **Diagnostic moteur, en local** — déjà en place. Un adaptateur **OBD2 ELM327**
  Bluetooth, branché sur la prise sous le volant, donne les codes défaut et les
  mesures en direct (régime, température, tension). C'est l'équivalent réaliste
  de « Jarvis analyse le moteur de la voiture dans le garage ». Page mécanique de
  Jarvis.
- **Commandes à distance (verrouillage, climatisation, recharge, position)** —
  par la voiture connectée de la marque, via **Home Assistant** :
  - [Renault / Dacia / Alpine](https://www.home-assistant.io/integrations/renault/) (compte My Renault) ;
  - [Tesla Fleet](https://www.home-assistant.io/integrations/tesla_fleet) (appli développeur à créer) ;
  - **BMW** : l'ancienne voie ConnectedDrive a été bloquée fin 2025 ; la nouvelle
    s'appelle **CarData** (gratuite, Europe) ;
  - **Stellantis** (Peugeot, Citroën, DS, Opel) : intégrations communautaires,
    souvent instables (erreurs de jeton fréquentes).

  Une fois la voiture dans Home Assistant, on branche Home Assistant sur Jarvis
  avec un seul connecteur MCP (préréglage « Voiture » dans les Réglages).

Ce qui reste **impossible ou interdit** : démarrer ou ouvrir une voiture qui
n'offre pas ces commandes officielles. Il n'y a pas de contournement légal.

## Fiction contre réalité : la ligne de partage

| Dans les films | Dans la vraie vie |
| --- | --- |
| Jarvis **casse un chiffrement** en direct | Impossible pour quiconque : c'est verrouillé par les mathématiques, pas par la puissance de calcul. Même tous les ordinateurs de la Terre pendant plus que l'âge de l'univers n'y suffiraient pas. |
| Jarvis **entre dans n'importe quel système** | Techniquement possible seulement en exploitant une faille — et **illégal sans autorisation** (délit), en France comme ailleurs. |
| Jarvis **« ouvre » un appareil de Tony** | Réel, parce que Tony en est le **propriétaire** : on **réinitialise** l'appareil (bouton reset, mode récupération), on ne « déchiffre » rien. |
| Jarvis **intercepte des communications** | Fiction. Garde-fous volontaires dans le code contre ce genre d'usage. |

**Pourquoi c'est une force, pas une limite.** Un assistant qui passe par les
portes officielles, tu peux lui confier ta maison, tes comptes et ta voiture
sans qu'il devienne un risque pour toi. Un assistant qui « force les serrures »
serait le premier à pouvoir être retourné contre toi. Les garde-fous de Jarvis
(clés au coffre-fort, actions notées, voix inconnue bloquée, commandes
destructrices refusées) sont donc au cœur du projet, pas un détail.

## En une phrase

Le Jarvis du film est **omniscient par piratage** ; le nôtre devient
**omniprésent par connecteurs** : chaque appareil qui ouvre une porte officielle
peut se brancher, et Home Assistant + MCP permettent d'en relier des centaines
sans nouvelle version de Jarvis.
