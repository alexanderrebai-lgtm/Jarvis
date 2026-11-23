# Compagnon de jeu

Jarvis reconnaît tout seul le jeu qui tourne et ouvre la page qui correspond à son genre. Rien à configurer.

## Ce qui se passe

1. **Détection** (toutes les 10 secondes) : Jarvis regarde les programmes lancés sur le PC.
   - Par **nom** : un catalogue (Call of Duty, EA Sports FC / FIFA, GTA V, Red Dead 2, Microsoft Flight Simulator, X-Plane, DCS, Elden Ring, The Witcher 3, Skyrim, Cyberpunk, Fortnite, Valorant, CS2, League of Legends, Minecraft, F1, Le Mans Ultimate, Assetto Corsa, iRacing, Forza…).
   - Par **dossier d'installation** : tout programme lancé depuis une bibliothèque de jeux (Steam, Epic, EA, Ubisoft, Xbox, Rockstar, GOG, Riot, Battle.net) est un jeu, même absent du catalogue. Son genre est deviné d'après son nom.
2. **Page adaptée** : simulation auto → *Ingénieur de course* (radio, pneus, écarts) ; tout le reste → *Compagnon de jeu*, dont les boutons changent selon le genre (tir, sport, monde ouvert, aventure, vol, stratégie, survie, MOBA, autre).
3. **Mode jeu** : pour tous ces jeux, Jarvis libère la carte graphique, se tait et réserve l'écran du milieu au jeu.

## La page « Compagnon de jeu »

- **Coach** : boutons du genre (« Mise au point », « Check-list de l'avion », « Meilleures armes », « Tactique conseillée », « Je suis bloqué »…) et une question libre. Jarvis cherche sur Internet pour rester à jour des patchs.
- **Sans spoiler** : coché par défaut pour l'aventure et le monde ouvert. Jarvis donne un indice d'abord, jamais la fin de l'histoire.
- **Regarder mon écran** : à ta demande seulement, Jarvis fait une capture pour voir où tu en es (il ne clique sur rien).
- **Où j'en suis** : tes notes de progression par jeu, que Jarvis te rappelle ensuite. À la voix : « Note que je suis au chapitre 3 », « À quoi je joue ? ».
- **Joué récemment** : temps de jeu par jeu.

## Réglages (Réglages → Toi et ta ville)

- **Ouvrir la page du jeu automatiquement** : *oui si tu as un second écran* (par défaut : la page ne s'ouvre jamais par-dessus ton jeu), *toujours*, ou *jamais*. Avec un seul écran, dis « ouvre le compagnon de jeu ».
- **Autres jeux à détecter** et **Jeux déclarés à la main** (`Nom=programme.exe=genre ; …`) pour les rares jeux invisibles.
- Jeu non reconnu ? Dans la page : « Nom du jeu » + genre → « C'est parti ».

## À savoir

- Les noms de programmes du catalogue viennent de mémoire et n'ont pas pu être testés avec les vrais jeux : une mise à jour du jeu peut les changer. Le repérage par dossier rattrape la plupart des cas.
- Les jeux lancés hors des bibliothèques habituelles (dossier perso) ne sont repérés que s'ils sont dans le catalogue ou déclarés.
- Pas de lecture en direct de la partie (score, position…), sauf pour la simulation auto déjà prise en charge. Des adaptateurs par jeu (LoL, CS2, Elite Dangerous, MSFS…) pourront venir ensuite.
- Rien ne quitte le PC, sauf la question posée au coach (envoyée à Claude, avec recherche web).
