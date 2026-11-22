# Contrôler la voiture avec Jarvis

Deux niveaux, qui se complètent. Le premier est déjà dans Jarvis ; le second
demande une petite installation à la maison.

## Niveau 1 — Diagnostic moteur (déjà en place, local)

Ce que Jarvis sait déjà faire, sans rien de plus qu'un adaptateur à ~15–25 € :

- **Adaptateur OBD2 ELM327 Bluetooth**, branché sur la prise sous le volant
  (toutes les voitures depuis ~2001 essence / ~2004 diesel en ont une).
- Jarvis lit alors les **codes défaut**, les efface, et affiche les **mesures en
  direct** (régime, température, tension, charge moteur…). Page mécanique.

C'est l'équivalent réaliste de « Jarvis analyse le moteur dans le garage ».
Rien à installer de plus : appairer l'adaptateur en Bluetooth dans Windows.

## Niveau 2 — Commandes à distance (verrouillage, climatisation, recharge, position)

Là, il n'y a **pas de contournement** : la voiture n'accepte ces ordres que par
le service officiel de ta marque (le même que l'appli du constructeur). La façon
propre de relier ça à Jarvis passe par **Home Assistant**, le « cerveau de la
maison » gratuit.

### Ce qu'il te faut

1. **Un petit ordinateur qui tourne en permanence pour Home Assistant.** Au
   choix :
   - un **Raspberry Pi 5** (~80 €) avec Home Assistant OS — le plus simple ;
   - ou Home Assistant dans une machine virtuelle sur ton PC (gratuit, mais le
     PC doit rester allumé) ;
   - ou un vieux mini-PC qui traîne.
2. **Le compte connecté de ta voiture** (le même identifiant que l'appli du
   constructeur sur ton téléphone), et que ta voiture ait bien les **services
   connectés activés** (souvent un abonnement, parfois gratuit les premières
   années).
3. **L'intégration de ta marque dans Home Assistant.** Selon la marque :
   - **Renault / Dacia / Alpine** : intégration officielle « Renault » (compte
     My Renault). Recharge et programmation ; verrouillage/climatisation selon
     le modèle.
   - **Tesla** : intégration officielle « Tesla Fleet » (il faut créer une
     petite application développeur — un peu technique).
   - **BMW / MINI** : « BMW CarData » (gratuit, Europe ; l'ancienne voie
     ConnectedDrive a été fermée fin 2025).
   - **Peugeot / Citroën / DS / Opel (Stellantis)** : intégrations
     communautaires, souvent instables (erreurs de connexion fréquentes).
   - **Autres marques** : regarde la liste
     [Home Assistant → Voitures](https://www.home-assistant.io/integrations/category/vehicles_transport/cars_evs/),
     ou l'option universelle **Smartcar** (beaucoup de marques, verrouillage,
     position, kilométrage).
4. **Relier Home Assistant à Jarvis** : une seule fois, avec le préréglage
   **« Voiture »** dans Jarvis → Réglages → Connecteurs. (Dans Home Assistant :
   Paramètres → Appareils et services → ajouter « Model Context Protocol
   Server » ; puis un jeton d'accès longue durée à coller dans Jarvis.)

Une fois en place, tu pourras dire : « Hey Jarvis, est-ce que la voiture est
verrouillée ? », « préchauffe la voiture pour 8 h », « quelle autonomie reste-t-il ? ».

### Résumé des coûts

| Élément | Coût indicatif |
| --- | --- |
| Adaptateur OBD2 (diagnostic, déjà géré par Jarvis) | 15–25 € |
| Raspberry Pi 5 pour Home Assistant (ou VM gratuite sur le PC) | 0–80 € |
| Services connectés de la voiture | selon la marque (souvent inclus un temps, puis abonnement) |
| Intégration dans Home Assistant | gratuit |

### Ce qui reste impossible

Démarrer ou déverrouiller une voiture qui n'offre pas ces commandes officielles.
Il n'y a pas de méthode légale de contournement, et Jarvis ne le fera pas (voir
`comment-jarvis-se-connecte.md`).
