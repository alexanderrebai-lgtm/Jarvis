# J.A.R.V.I.S. pour Windows

Le logiciel Jarvis pour ton PC. Il tourne en permanence, t'entend quand tu dis « Jarvis » ou quand tu claques deux fois des mains, te répond avec une voix féminine, voit ton écran et tes caméras, comprend tes gestes et pilote l'ordinateur. Il reprend tout ce que Jarvis savait déjà faire : maison Tapo, mails, agenda, notes, mémoire, réservations et calculs de décision.

Il te réveille aussi le matin d'après ton planning, avec ta musique et un message du jour. Il reconnaît ta voix, travaille en tâche de fond, fait de vraies recherches sourcées, calcule et t'apprend à faire. Il tient ton carnet d'entretien, lit les codes défaut de ta voiture, range tes papiers et suit ton budget. Il garde enfin la trace de tout ce qu'il fait, avec sauvegardes chaque nuit.

## L'accueil et les pages

Le style reprend l'idée de l'écran de Jarvis dans Iron Man. Le fond est sombre, parcouru de pistes de circuit où circulent des impulsions de lumière. En haut, une rangée de boutons ronds ouvre les pages. **Jarvis est au centre de chaque page**, sous la forme d'une boule de lumière vivante entourée de deux anneaux fins. La lumière tourne à l'intérieur et la surface ondule avec la voix. Sa couleur indique ce qu'il fait :

| Couleur | Jarvis… |
|---|---|
| Bleu doux | attend |
| **Bleu vif** | t'écoute |
| **Jaune** | réfléchit (les anneaux tournent vite) |
| Bleu clair qui pulse | parle |
| **Rouge** | est en surveillance complète |

Des lignes de flux lumineuses relient Jarvis à des cartes nettes, chacune avec sa couleur : bleu pour le général, or pour la météo et la sécurité, vert pour la maison et le système, violet pour les rappels et la R&D.

La page Ingénieur a son propre style, celui d'un écran de volant de LMH ou de F1 : carbone, gros chiffres, orange et rouge, LED de régime qui s'allument quand Jarvis parle. Jarvis y reste au centre, en orange quand il attend.

- **L'accueil** reste toujours affiché sur l'écran du centre :
  - à gauche : la date dans un anneau qui avance avec la journée, le **prochain réveil** (avec un bouton « Passer »), les rendez-vous et les rappels ;
  - à droite : la météo, la maison et les **dispositions** (un clic les ouvre) ;
  - en bas : les jauges du PC et « En ce moment » (tâches de fond en cours, révisions, séance de simu, mouvement détecté, mails non lus).
- **Les autres pages s'ouvrent seulement quand tu les demandes**, chacune sur son écran :

| Page | Pour quoi | Écran par défaut |
|---|---|---|
| Ingénieur | Télémétrie en direct : position, écarts, temps, carburant, énergie, pneus, radio, tours | gauche |
| Travail | Agenda et mails du jour, et ce que Jarvis prépare pour toi : bilans d'équipe, plannings, entretiens | droite |
| Code | Les fichiers du projet, le code, et l'**aperçu en direct** du résultat, qui se met à jour à chaque modification | droite |
| R&D | Le journal du projet, les modèles 3D et images, les résultats de calculs et d'essais | gauche |
| Sécurité | Tes caméras Tapo en direct, la détection de mouvement, l'historique avec photos | droite |
| Performances | Processeur, carte graphique, mémoire (charge et températures), disques, réseau, programmes gourmands | gauche |
| Diagnostic | Le bilan de santé de Jarvis : chaque organe, son état, et quoi faire pour le corriger | droite |

Pour piloter les pages, clique sur les boutons ronds du haut, ou parle-lui :
- « Ouvre l'ingénieur », « montre-moi les performances », « affiche la sécurité sur l'écran de droite » ;
- « **Ouvre le code et la R&D** » : les deux pages restent ouvertes ensemble ;
- « Mets le code à gauche » : la page se déplace, et Jarvis retient ce choix ; « **échange les écrans** » inverse les places ;
- « Ferme la R&D », « ferme tout » (l'accueil reste ouvert).

`Échap` ou la croix en haut à droite ferment aussi une page.

### Un écran aujourd'hui, trois demain

- **Avec un seul écran** (ton cas pour l'instant), deux pages demandées ensemble se partagent l'écran en deux moitiés, et une disposition de trois pages le coupe en tiers. Les pages s'adaptent à leur largeur. Si tu en ouvres une troisième, la plus ancienne se range.
- **Avec plusieurs écrans**, chaque page occupe son écran. Deux pages demandées ensemble vont sur deux écrans différents.
- **Pendant une partie** (Le Mans Ultimate ou F1 détectés), l'écran du milieu est réservé au jeu : les pages vont à gauche et à droite, et Jarvis ne passe jamais devant. Avec un seul écran, le jeu reste devant et Jarvis te parle à la radio.

### Les dispositions

Une disposition ouvre plusieurs pages d'un mot, chacune à sa place.

| Disposition | Pages |
|---|---|
| « Mode course » | Ingénieur à gauche, Performances à droite |
| « Mode atelier » | Code à gauche, R&D à droite |
| « Mode bureau » | Travail à gauche, Accueil à droite |

Tu peux les modifier et en créer, y compris pour trois écrans. Par exemple : « crée une disposition labo avec le code à gauche, la R&D au centre et les performances à droite », ou, une fois les pages placées, « garde cette disposition sous le nom soirée ». Sur un seul écran, une disposition à trois pages s'affiche en tiers.

Restent aussi :
- **La bulle flottante** (`Ctrl + Alt + J` ou le geste ✌️), toujours au-dessus des autres fenêtres.
- **L'icône près de l'horloge** : un clic droit donne accès aux pages, au micro, aux caméras, au mode « ne pas déranger », aux réglages et au lancement avec Windows.

### Caméras de surveillance Tapo

1. Dans l'appli Tapo, ouvre chaque caméra : *Paramètres → Paramètres avancés → Compte de la caméra*, et crée un identifiant et un mot de passe. Ce compte sert à lire la vidéo sur ton réseau.
2. Réserve une adresse IP fixe pour chaque caméra dans ta box.
3. Dans les réglages : `TAPO_CAMERA_COMPTE`, `TAPO_CAMERA_MOT_DE_PASSE`, et `TAPO_CAMERAS=Entrée=192.168.1.30,Jardin=192.168.1.31`. Ensuite, relance Jarvis.

La vidéo reste chez toi : Jarvis la lit en local et la décode lui-même (ffmpeg est installé avec Jarvis). Quand il détecte un mouvement, il enregistre une photo dans `Documents\Jarvis\securite`. Les changements de lumière (lampe, vision nocturne) sont ignorés. Trois modes :

| Mode | Ce qui se passe à chaque mouvement |
|---|---|
| Arrêtée | La photo est enregistrée, sans alerte |
| Simple (« active la surveillance ») | Jarvis l'annonce et t'envoie une notification |
| **Complète** (« surveillance complète », ou « je pars ») | Jarvis vérifie qu'il s'agit bien d'une **personne** : un chat ou une ombre ne déclenchent rien. Si c'en est une, il enregistre **20 secondes de vidéo** et t'envoie **la photo sur ton téléphone** (Telegram). Il ouvre la page Sécurité, allume les lumières et prévient l'intrus à voix haute (« Vous êtes filmé, et le propriétaire vient d'être prévenu. »). Il reste **rouge** tant que ce mode est actif. |

Seule **ta voix** (voir le verrou vocal) peut désactiver la surveillance : un intrus qui dit « Jarvis, désactive la surveillance » n'est pas obéi.

Pour les alertes sur le téléphone, crée un bot Telegram avec @BotFather, envoie-lui un message, et règle `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID`. L'identifiant s'obtient en ouvrant `https://api.telegram.org/bot<jeton>/getUpdates`. `SURVEILLANCE_LUMIERES` choisit les lampes de dissuasion (toutes par défaut), `SURVEILLANCE_MESSAGE` la phrase, et `SURVEILLANCE_DISSUASION=false` désactive lumières et message.

### Météo

Mets ta ville dans `JARVIS_VILLE`. Les données viennent d'Open-Meteo, gratuit et sans compte.

## Lui parler

| Comment | Effet |
|---|---|
| « Jarvis, … » | Il écoute la phrase et agit. Le nom peut aussi venir à la fin : « Éteins tout, Jarvis. » |
| « Jarvis. » seul | Il répond « Oui, Alex ? » et attend ta demande |
| **Double claquement de mains** | Pareil : il se met à l'écoute |
| Après une réponse | Pendant 20 secondes, tu continues sans redire « Jarvis » |
| « Stop », « Arrête », « Tais-toi » | Il se tait et abandonne la tâche en cours |
| **Pendant qu'il parle** : « Jarvis, … », « stop », « attends » | Il s'arrête net et t'écoute (tu peux lui couper la parole) |
| Écrire dans l'interface ou la bulle | Comme à l'oral |

### Réflexes : instantanés, sans Claude

Les demandes simples sont traitées directement sur le PC, en moins d'une seconde, sans consommer ton abonnement :
- **Lumières** : « allume la lampe du salon », « éteins tout », « mets la chambre en bleu », « lumière du salon à 30 % » ;
- **Musique** (Spotify) : « mets de la musique », « mets Daft Punk sur Spotify », « pause », « chanson suivante », « monte le son », « volume à 40 » ;
- **Minuteurs et rappels** : « minuteur 10 minutes pour les pâtes », « rappelle-moi dans 20 minutes de sortir le linge » ;
- **Réveil** : « réveille-moi à 6 h 30 demain », « pas de réveil demain », « à quelle heure tu me réveilles ? » ;
- **Maison** : « surveillance complète », « désactive la surveillance », « mode ne pas déranger » ;
- **Routines** : « bonne nuit », « je pars », « je suis rentré », « je vais rouler » (voir plus bas) ;
- l'heure, la date, les pages et les dispositions.

### Ta voix : le verrou vocal

Dis « **Jarvis, apprends ma voix** », puis répète les cinq phrases qu'il te donne. Ensuite :
- **ta voix** peut tout demander ;
- **une voix inconnue** (télé, invité) peut poser des questions générales et lancer un minuteur ou de la musique. Elle ne peut ni agir sur le PC, ni toucher à la maison, ni lire tes mails, ni rien apprendre de privé.

L'empreinte de ta voix est calculée et gardée sur ton PC (modèle WavLM). « Oublie ma voix » l'efface. Ce que tu tapes au clavier est toujours accepté. Si tu es parfois mal reconnu (rhume, micro différent), baisse un peu `VOIX_SEUIL` (0,86 par défaut).

### Gestes (caméra principale)

| Geste | Effet |
|---|---|
| ✋ Main ouverte, immobile | Il arrête de parler |
| ✋ Main ouverte qui **balaie** vers la gauche ou la droite | Les pages changent de place (sur un écran : les moitiés s'échangent). Inactif pendant une partie, pour ne pas réagir au volant |
| ☝️ Index levé | Il se met à l'écoute |
| 👍 Pouce levé | « Oui, vas-y » pendant un échange ; « je suis debout » quand le réveil sonne |
| ✌️ V | Affiche ou cache la bulle |
| 🤟 Signe « je t'aime » | Mode « ne pas déranger » |
| ✊ Poing fermé et main qui bouge | Fait tourner le modèle 3D affiché, comme si tu l'attrapais |

### Raccourcis clavier

- `Ctrl + Alt + Espace` : il se met à l'écoute
- `Ctrl + Alt + J` : affiche ou cache la bulle
- `Ctrl + Alt + S` ou `Échap` : stop

## Ce qu'il sait faire

- **Le PC** : PowerShell, fichiers, installation de logiciels (winget), applications, fenêtres, souris, clavier, volume, musique. Il regarde l'écran avant de cliquer et vérifie après.
- **Les yeux** : il voit tous tes écrans et **toutes tes caméras** (jusqu'à six), pour te voir sous plusieurs angles ou regarder ce que tu lui montres.
- **La maison** : ampoules et prises Tapo directement depuis le PC ; autres marques via Home Assistant.
- **La science et les simulations** : il écrit et exécute de vrais programmes Python (physique, statistiques, finance, traitement de données) et affiche les graphiques.
- **La mécanique et la modélisation 3D** : il modélise des pièces en OpenSCAD ou CadQuery, exporte en STL dans `Documents\Jarvis\modeles` (prêt pour l'impression 3D) et les affiche en 3D. Il donne les cotes, les tolérances et les couples de serrage, en signalant ce qui doit être vérifié dans la documentation du constructeur.
- **La recherche, dont l'IA** : recherche web, lecture de pages, recoupement des sources, articles d'arXiv.
- **Le travail** : plannings, indicateurs d'équipe (DMT, décroché, satisfaction), analyse de fichiers Excel exportés, préparation d'entretiens, scripts d'appel, supports de formation.
- **Les mails et l'agenda** (si Google est connecté), **les notes, les rappels et la mémoire**, **les réservations en ligne**, **les calculs de décision**.
- **De lui-même** : briefing du matin à 7 h 30, rappels à l'heure, annonce des rendez-vous 15 minutes avant, signalement des mails importants.

## Mémoire : ce qu'il retient

Le modèle d'IA lui-même n'apprend pas : on ne peut pas réentraîner Claude. Jarvis garde donc des traces, et les relit :
- **La conversation continue** d'un jour à l'autre (Claude Code résume automatiquement les plus anciens échanges quand elle devient longue). « Nouvelle conversation » dans le menu repart de zéro sans rien effacer d'autre.
- **Le journal de bord** : chaque demande, chaque réponse et les outils utilisés sont notés, un fichier par jour (`%APPDATA%\Jarvis\data\journal`). Il y cherche quand tu demandes « ce qu'on a fait sur le volant le mois dernier ».
- **La mémoire durable** : il note de lui-même ce que tu lui apprends (ton matériel, ta voiture, tes collègues, tes projets). Ces faits sont relus au début de chaque conversation.
- **Les consignes** : quand tu le corriges (« la prochaine fois, donne-moi les temps au millième »), il enregistre une consigne qu'il respecte ensuite en priorité.
- **Les projets** : chaque projet a son dossier dans `Documents\Jarvis\projets`, avec un `JOURNAL.md` qu'il tient à jour (objectif, décisions, versions, essais, prochaines étapes) et relit avant de reprendre.

Tu peux lui demander « qu'est-ce que tu sais de moi ? » ou « oublie que… ».

## Avis, R&D et simulation

- **Son avis** : il donne une position claire, appuyée sur des faits et des chiffres, dit ce qui le ferait changer d'avis et te prévient si ton idée a un défaut.
- **R&D** : il suit une méthode (cadrage, état de l'art, deux ou trois pistes avec sa recommandation, prototype rapide, mesures, itérations). Pour un logiciel, il crée un vrai projet avec Git et des tests, l'exécute et le corrige jusqu'à ce qu'il marche. Pour un objet, il le modélise en 3D, exporte en STL et STEP et donne cotes, tolérances et matériaux. Pour l'électronique, il donne le schéma, les composants et le code.
- **Simulation automobile** : réglages (pressions, géométrie, barres, ressorts, amortisseurs, appuis, freins, différentiel), lecture de tes exports de télémétrie, trajectoires, matériel et force feedback, stratégie. Il explique la physique de chaque réglage et propose un changement à la fois.

## Ingénieur de course : Le Mans Ultimate et F1

Pendant que tu roules, Jarvis devient ton ingénieure à la radio, avec un petit bip avant chaque annonce. La page Ingénieur (« ouvre l'ingénieur ») affiche toute la télémétrie :
- **À chaque tour** : ton temps et l'écart avec ton meilleur, « meilleur tour ! », les places gagnées.
- **Carburant et énergie** : il prévient quand le carburant ne suffira pas à finir, et en endurance, il annonce l'arrêt (« Box, box ! ») avant la panne de carburant ou d'énergie virtuelle.
- **Pneus** : usure à 55, 70 et 85 %, et surchauffe.
- **Dégâts** : ailerons, fond, moteur, avec le conseil de rentrer si c'est grave.
- **Course** : drapeaux, voiture de sécurité, pénalités, contacts, fenêtre d'arrêt (F1), pluie annoncée (F1), dernier tour, arrivée. Quand quelqu'un revient dans la seconde ou que tu es dans la seconde de la voiture devant, il te le dit.
- **Tes questions** : « essence ? », « les pneus ? », « l'écart ? », « position ? », « combien de tours ? » ont une réponse **immédiate**. Les questions plus complexes (« je rentre maintenant ou au prochain tour ? ») passent par Claude, qui lit la télémétrie complète.
- **Après la séance** : un bilan (meilleur tour, tour médian, régularité, position, consommation), les tours enregistrés en CSV dans `Documents\Jarvis\simu`, et l'analyse si tu la demandes.

Pendant une séance, les autres annonces (briefing, rappels) se taisent. `INGENIEUR_BAVARDAGE` règle la quantité d'annonces : `minimal`, `normal` ou `bavard`.

### Réglages des jeux

- **F1 25** : *Paramètres → Télémétrie* : Télémétrie UDP **activée**, diffusion **désactivée**, adresse IP `127.0.0.1`, port `20777`, fréquence d'envoi **20 Hz**, format UDP **2025** (ou celui de la saison 2026).
- **Le Mans Ultimate** : rien à régler. Jarvis lit l'interface web que le jeu ouvre sur ton PC (port 6397).

### Parler avec un bouton du volant (T300 RS GT)

1. Lance une séance, puis appuie sur le bouton que tu veux utiliser : son numéro s'affiche sur l'accueil, sous le noyau.
2. Mets ce numéro dans `BOUTON_VOLANT_PARLER` (réglages), puis relance Jarvis.
3. En piste : appuie sur le bouton, pose ta question, sans dire « Jarvis ».

Un micro-casque est recommandé pendant les courses : le bruit du jeu dans les enceintes gêne la reconnaissance vocale.


## Le réveil du matin

Jarvis te réveille d'après **ton planning de travail** :
1. Dix minutes avant, les ampoules de la chambre s'allument très doucement en lumière chaude, puis montent comme un lever de soleil.
2. À l'heure, l'écran se rallume et **ta playlist Spotify** démarre sur le PC, avec un volume qui monte doucement.
3. Tu dis « **je suis debout** » (ou tu claques deux fois des mains, ou tu lèves le pouce). La musique baisse et Jarvis enchaîne avec son message du matin, à la manière de Tony Stark : la météo, ton poste et ton premier rendez-vous, une ou deux actualités françaises importantes, un point utile (échéance, entretien de la voiture, révisions), et une pointe d'humour.
4. « **Encore cinq minutes** » repousse le réveil. Sans réponse, il te relance toutes les cinq minutes, monte le volume, et s'arrête au bout de 30 minutes.

**L'heure** : si ton planning dit que tu commences à 9 h, il sonne 1 h 15 avant (`REVEIL_AVANT_TRAVAIL=75`), donc à 7 h 45. Les jours de repos, il ne sonne pas (`REVEIL_REPOS`). Sans planning, il sonne à 7 h 45 du lundi au vendredi (`REVEIL_HEURE`, `REVEIL_JOURS`). « Réveille-moi à 6 h 30 demain » et « pas de réveil demain » passent avant tout.

**Le planning** : mets le chemin de ton fichier Excel dans `PLANNING_FICHIER` (par exemple `C:\Users\Alex\Documents\Travail\planning.xlsx`). Jarvis le relit à chaque modification. Il reconnaît seul les formats courants :
- une ligne par conseiller et une colonne par jour, avec des cases du type « 08:30-16:30 », « 9h-17h », « RH » ou « CP » ;
- une ligne par jour et une colonne par personne ;
- une liste avec des colonnes Date, Début et Fin.

Si ton planning utilise des codes (M, S, J…), décris-les dans `PLANNING_CODES=M=08:00-15:00,S=14:00-21:00`. Si ton nom s'écrit autrement dans le planning, règle `PLANNING_NOM`. Si le format est vraiment particulier, Jarvis demande à Claude de le lire, après avoir remplacé les noms de tes collègues par des pseudonymes.

**Le PC doit être allumé ou en veille.** Jarvis programme Windows pour sortir de veille 6 minutes avant. Si Windows a redémarré pour une mise à jour et attend ton mot de passe, il ne peut rien faire : garde le réveil de ton téléphone en secours les premiers jours.

### Relier Spotify (Premium) — 5 minutes, une seule fois

1. Va sur [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard), connecte-toi avec ton compte Spotify et clique sur **Create app**.
2. Nom : « Jarvis ». Description : « Assistant personnel ». **Redirect URI** : `http://127.0.0.1:8898/spotify` (exactement). Coche **Web API**, puis enregistre.
3. Copie le **Client ID** dans `SPOTIFY_CLIENT_ID` (réglages), puis relance Jarvis.
4. Dis « **Jarvis, connecte Spotify** » : une page s'ouvre, accepte. C'est fait (le jeton est rangé dans le coffre-fort).

Tu n'as pas encore de playlist : au premier réveil, Jarvis crée « **Réveil Jarvis** ». Elle commence en douceur (Here Comes the Sun, Lovely Day…), monte en énergie, et finit sur AC/DC, clin d'œil à Tony. Pour la modifier : « ajoute cette chanson au réveil » pendant qu'un titre joue, ou « ajoute Daft Punk au réveil ». Pour en prendre une autre : « utilise cette playlist pour le réveil » avec son lien (`SPOTIFY_REVEIL`).

L'appli Spotify doit être installée sur le PC ; Jarvis la lance si besoin. Si Spotify ne répond pas en 20 secondes, une sonnerie intégrée prend le relais. Depuis février 2026, Spotify demande un compte Premium au propriétaire de l'appli, et le tien l'est. Je n'ai pas pu vérifier dans leur documentation que toutes les commandes de lecture restent ouvertes aux applis personnelles : si quelque chose coince, la page Diagnostic le dira, et la sonnerie de secours fonctionne quoi qu'il arrive.

## Tâches de fond et recherches approfondies

Pour une mission longue (analyser 40 fichiers, écrire un projet complet), Jarvis lance une **tâche de fond** et te répond tout de suite. Tu continues à lui parler pendant ce temps, l'avancement s'affiche dans « En ce moment », et il t'annonce la fin en affichant le résultat.

« **Fais une recherche approfondie sur…** » : il découpe la question en sous-questions et cherche sur le web, dans la littérature scientifique (arXiv, Semantic Scholar, OpenAlex, PubMed) et dans ta bibliothèque. Il recoupe les sources, calcule ce qui se calcule, puis écrit un rapport dans `Documents\Jarvis\recherches`. Le rapport contient une réponse courte, ce qui est établi, ce qui est débattu, ce qui reste inconnu, sa recommandation et les sources numérotées. Chaque affirmation porte un **niveau de confiance**. Pour OpenAlex, crée une clé gratuite sur openalex.org (`OPENALEX_CLE`) ; sans elle, les trois autres sources suffisent.

## Ta bibliothèque

Dépose tes PDF, manuels, notices, cours et notes dans `Documents\Jarvis\bibliotheque`. Jarvis les indexe sur ton PC, par mots-clés et par le sens (modèle multilingue local), et répond en citant le fichier et la page : « (manuel-T300.pdf, p. 12) ». Rien n'est envoyé ailleurs pour l'indexation ; seuls les passages utiles partent vers Claude quand il répond.

## Devenir autonome : le mode mentor

Tu choisis comment il t'aide :
- « **Fais-le pour moi** » : il fait (par défaut) ;
- « **Fais-le avec moi** » : il avance étape par étape, explique le pourquoi, et te laisse faire les étapes simples ;
- « **Guide-moi** » : tu apprends à faire seul. Il donne la méthode, un indice, une question, et corrige ce que tu proposes. La solution ne vient que si tu bloques ou la demandes.

Pour un sujet que tu veux maîtriser (réglages de suspension, Python, électronique, management), il te propose un **parcours** par étapes avec des exercices sur tes vrais projets, écrit dans `Documents\Jarvis\apprentissage`. Il crée aussi des **fiches de révision** qui reviennent au bon moment (répétition espacée, comme Anki) : « on révise ».

## Le labo de calcul

Jarvis ne calcule plus « de tête » : il exécute du Python sur ton PC (numpy, scipy, sympy, pandas, matplotlib, pint), dans un environnement à part qu'il prépare la première fois (« prépare le labo »). Sa boîte à outils contient :
- les matériaux courants, PLA, PETG, ABS, nylon carbone, alu, acier ;
- les poutres et les coefficients de sécurité ;
- la résistance réelle d'une pièce imprimée en 3D (remplissage, sens des couches) ;
- les couples de serrage ;
- l'électronique : résistance de LED, pont diviseur, autonomie de batterie, section de câble, valeurs normalisées.

Il montre les graphiques et note chaque essai dans le **cahier d'expériences** du projet (`CAHIER.md`). Il faut Python : `winget install -e --id Python.Python.3.12`.

## Connexions surveillées et copie des mots de passe

- **Veilleur** : toutes les 15 minutes, Jarvis vérifie Claude, Google, Spotify, Tapo, les caméras, la voix, le micro, le disque et les sauvegardes. Si l'un d'eux décroche (deux contrôles de suite), il te prévient une fois (notification et Telegram), puis encore quand c'est revenu.
- **Google** : publie ton appli Google (« En production »), sinon Google coupe l'accès tous les 7 jours. Le guide est dans Réglages → Gmail et Google Agenda → Comment faire, étape 6.
- **Copie des mots de passe** : le coffre-fort est lié à ta session Windows. Choisis un **mot de passe de sauvegarde** (Réglages → Sauvegardes) : à chaque sauvegarde, Jarvis écrit `jarvis-coffre.chiffre`, lisible seulement avec ce mot de passe. Après une réinstallation : réinstalle Jarvis, tape le même mot de passe, enregistre, puis « Restaurer mes mots de passe… ».
- **Test de démarrage** : avant chaque publication, GitHub lance Jarvis sous Windows ; s'il ne démarre pas, la mise à jour n'est pas publiée.

## Mode jeu (Le Mans Ultimate, F1…)

Dès qu'un jeu est détecté (ou sur « Jarvis, mode jeu », ou par le menu de l'icône), Jarvis laisse la place :
- la voix locale (plusieurs Go sur la carte graphique) s'arrête : voix en ligne pendant le jeu ;
- la reconnaissance vocale passe sur un petit modèle au processeur (Whisper base) ;
- webcams, gestes et animations se mettent en pause ; la boule ralentit ;
- mesures du PC toutes les 20 s, pas de sauvegarde, de scan de la bibliothèque ni de contrôles du veilleur ;
- tous les processus de Jarvis passent en priorité basse.

À la sortie du jeu, tout reprend. Hors jeu, la voix locale se décharge seule après 20 minutes sans parler et se recharge en arrière-plan (la première phrase part alors en voix en ligne). Réglages → Toi et ta ville : désactiver le mode jeu automatique, ajouter d'autres jeux.

## Santé du PC

Page « Santé du PC » (ou « Jarvis, ouvre le diagnostic du PC ») :
- lit ce que Windows garde sur 30 jours : arrêts brutaux (Kernel-Power 41 : coupure sans écran bleu ou écran bleu avec son code), erreurs matérielles (WHEA), plantages du pilote graphique, rapports de plantage ;
- état de la carte NVIDIA (température, puissance, limite, pilote), mémoire (profil XMP), disques, plan d'alimentation, mode jeu, planification GPU, programmes au démarrage, âge du BIOS ;
- pendant chaque partie, la température et la puissance de la carte graphique sont écrites sur le disque toutes les 15 s : après un arrêt brutal, le bilan montre l'état de la carte juste avant ;
- après un redémarrage qui suit un arrêt brutal, Jarvis fait le bilan tout seul et prévient ;
- « Chercher des solutions sur Internet » : Claude cherche les causes connues pour ce matériel et ces symptômes et propose des actions ;
- actions sur clic seulement, réversibles : plan « Performances élevées », test de limite de la carte graphique à 80 % (jusqu'au redémarrage, Windows demande l'autorisation), nettoyage des fichiers temporaires, raccourcis vers les réglages de Windows ;
- « Rapport » enregistre le bilan dans Documents\Jarvis\rapports.

### Composants et optimisations

Dans la page Santé du PC, deux onglets de plus :
- **Composants** : processeur, carte graphique (température, mémoire vidéo, puissance, fréquences, liaison PCIe), mémoire (utilisée, engagée, fichier d'échange, barrettes et XMP), disques (santé, température, usure, place), réseau, système, et les programmes les plus gourmands (bouton « Fermer », jamais pour Windows ou Jarvis).
- **Optimisations** : catalogue de réglages reconnus et sans danger (mode jeu de Windows, enregistrement en arrière-plan de la Game Bar, planification GPU, démarrage rapide, transparence, point de restauration, TRIM, nettoyage de disque, fichier d'échange géré par Windows, plan d'alimentation, limite de la carte graphique) et programmes au démarrage (activer, désactiver). Chaque changement est noté dans le Journal ; les réglages du registre gardent leur ancienne valeur et s'annulent d'un clic ; ceux qui touchent au système passent par l'autorisation de Windows.

Claude peut faire la même chose à la voix (« Jarvis, optimise mon PC pour les jeux », « désactive Discord au démarrage ») avec les outils pc_sante, pc_composants, pc_optimisations, pc_optimiser, pc_action_sante, pc_demarrage et pc_fermer_programme. Une voix inconnue ne peut rien changer.

## Adapté au PC

Au démarrage, Jarvis lit le matériel (page Diagnostic → Profil matériel) et se règle :
- calculs au processeur (reconnaissance vocale, empreinte vocale, bibliothèque) sur la moitié des cœurs physiques, 2 pendant un jeu ;
- IA locale : il choisit un modèle Ollama qui tient entièrement dans la carte graphique (qwen3:8b pour 8 Go) et le décharge pendant les jeux ;
- voix locale : quelques cœurs seulement, calculs TF32 sur les cartes RTX ;
- pages fermées : mémoire libérée après 5 minutes (16 Go de mémoire ou moins), tout de suite en mode jeu ;
- modèle de la bibliothèque libéré après 5 minutes sans recherche ;
- processeur à puce graphique intégrée (Ryzen « G ») : l'interface de Jarvis peut tourner dessus, la carte NVIDIA reste aux jeux et à l'IA (Réglages → Toi et ta ville ; la puce doit être activée dans le BIOS).

## Regarde mon écran (optionnel)

Claude peut déjà regarder l'écran sur demande (« Hey Jarvis, qu'est-ce qu'il y a sur mon écran ? »). En plus, Réglages → Toi et ta ville → « Jarvis surveille mon écran » (par défaut non) : toutes les 5, 10 ou 15 minutes, Jarvis jette un œil et **ne parle que s'il voit un vrai souci** sur lequel il peut aider (erreur, blocage). Il se tait pendant un jeu et en « ne pas déranger », et chaque coup d'œil est une courte demande à Claude. À la voix : « surveille mon écran » / « arrête de regarder mon écran ».

## Briefings programmés

Réglages → Briefings programmés (ou « Hey Jarvis, chaque matin à 7 h résume-moi l'actualité du sim racing sur Telegram ») : une recherche web à heure fixe, que Jarvis te résume à la voix et/ou t'envoie sur Telegram. Choix du sujet, de l'heure, des jours et des canaux ; bouton « Envoyer maintenant » ; mise en pause. Un matin manqué (PC éteint) est rattrapé au démarrage, mais jamais la nuit. Claude peut aussi les créer, lister et supprimer à la voix (outils briefing_programmer, briefing_lister, briefing_supprimer).

## « Hey Jarvis » (mot d'éveil)

Par défaut, un petit détecteur (modèles openWakeWord : code Apache 2.0, modèles pré-entraînés CC BY-NC-SA 4.0, usage personnel) écoute seulement « Hey Jarvis », par blocs de 80 ms : environ 25 ms de calcul par seconde de son, sur un seul cœur. Tant qu'il n'a pas entendu le mot, **rien n'est transcrit** : la reconnaissance vocale (Whisper) dort, et une phrase de la télé ou d'une conversation ne réveille plus Jarvis. « Hey Jarvis » coupe aussi Jarvis s'il est en train de parler. Réglages → Voix et oreilles : « Comment réveiller Jarvis » (ou revenir à « son nom dans la phrase ») et sensibilité.

## Connecteurs MCP et page Mémoire

- **Connecteurs (Réglages → Connecteurs MCP)** : des outils en plus pour Claude au format standard MCP (Home Assistant, GitHub, Notion, un dossier du PC, mémoire de l'écran Screenpipe, imprimante 3D Bambu, voiture connectée via Home Assistant…), soit un programme lancé sur le PC, soit une adresse web. Exemples préremplis ; bouton « Tester » qui se connecte et liste les outils ; jetons au coffre-fort (refusés si le coffre-fort n'est pas disponible) ; relus à chaque conversation, sans redémarrer. Une voix inconnue ne peut pas s'en servir et chaque utilisation est notée dans le Journal.
- **Page Mémoire** (« Jarvis, ouvre ta mémoire ») : tout ce que Jarvis a retenu de toi, à chercher, corriger (cliquer sur le texte) ou oublier ; ajout manuel d'un souvenir ; notes et rappels.

## Mot d'éveil, mode absent et journal

- **Son nom** : Jarvis n'agit que si une phrase contient « Jarvis » (ou juste après une réponse). Ce qui ne lui est pas adressé n'est ni affiché ni gardé. Réglages → Voix et oreilles : autres noms, durée d'écoute de la suite (0 = toujours dire son nom), petit son quand il t'entend.
- **Mode absent** : « Jarvis, je pars » (ou « je sors », « mode absent ») coupe la musique, éteint les lumières, ferme les pages, laisse une minute pour sortir, active la surveillance complète et t'envoie un message Telegram. « Jarvis, je suis rentré » coupe la surveillance, allume le salon et résume ce qui s'est passé depuis ton départ.
- **Page Journal** : tout ce que Jarvis a fait, jour par jour, avec des filtres (mes demandes, automatique, alertes, refusé) et les dernières erreurs.

## Voix locale, plus humaine

Dans **Réglages → Voix et oreilles**, Jarvis peut parler avec **Chatterbox multilingue**, une voix libre (licence MIT) qui tourne sur ta carte graphique : plus naturelle et plus expressive que la voix Microsoft, et sans Internet.
1. Il faut Python (`winget install -e --id Python.Python.3.12`).
2. Clique sur **Installer la voix locale** : 10 à 20 minutes, plusieurs Go (PyTorch et le modèle). Jarvis te prévient à la fin.
3. **Moteur de voix** → « Voix locale », **Enregistrer**, puis **Écouter un essai**. La première phrase prend une minute (chargement du modèle) ; ensuite, quelques dixièmes de seconde par phrase avec une carte NVIDIA.
4. Facultatif : un **enregistrement de référence** de 10 à 20 secondes (voix française claire, sans musique) dont elle imite le timbre, et l'**expressivité** (0,3 calme, 0,8 très expressive).

Si la voix locale ne répond pas, Jarvis reprend aussitôt la voix Microsoft.

## La veille

Chaque matin avant le réveil, Jarvis lit les flux d'actualité sur l'actualité française, l'IA, Le Mans Ultimate et F1, la simulation et ton métier. Il en tire les grands titres du message du matin et un résumé (« quoi de neuf aujourd'hui ? »). Ajoute ou retire des sujets et des flux à la voix.

## Routines et minuteurs

| Phrase | Ce que fait Jarvis |
|---|---|
| « Bonne nuit » | Il te dit l'heure du réveil et ton premier rendez-vous, ferme les pages, éteint les lumières, passe en « ne pas déranger » et met les écrans en veille |
| « Je pars » | Il éteint tout et active la surveillance complète |
| « Je suis rentré » | Il désactive la surveillance, allume le salon et te résume ce qui s'est passé pendant ton absence |
| « Je vais rouler » | Il allume la prise du simulateur et ouvre la disposition course |

Tu peux les modifier ou en créer : « crée une routine cinéma : salon à 10 %, ne pas déranger ». Les minuteurs survivent à un redémarrage de Jarvis.

## Garage et diagnostic OBD

Dis-lui tes véhicules (« ma Golf 7 TDI a 112 000 km »). Il cherche le plan d'entretien du constructeur, note chaque intervention et estime le kilométrage d'après ta moyenne. Il te prévient au réveil quand une vidange, des plaquettes ou une courroie approchent.

Avec un **adaptateur OBD ELM327** (environ 20 €, en **Bluetooth classique** ou en USB, pas BLE), il lit les codes défaut et le témoin moteur, puis les mesures en direct : régime, température d'eau, tension, charge. Il te dit ce que signifie chaque code pour ton modèle. Appaire l'adaptateur dans Windows (code 1234 ou 0000), mets le contact, et dis « lis les codes défaut ». Il n'efface les codes qu'avec ton accord explicite.

## Procédures apprises

« **Regarde, je vais te montrer comment exporter le planning** » : fais la manipulation normalement en commentant si tu veux, puis dis « c'est fini ». Pendant ce temps, Jarvis note les fenêtres et les clics et prend des captures d'écran. Il ne note pas les touches tapées, donc tes mots de passe restent privés. Il écrit ensuite une procédure précise dans `Documents\Jarvis\procedures`, qu'il refait seul ensuite (« exporte le planning de décembre »). Tu peux aussi la lui dicter.

## Électronique (Arduino, ESP32)

Il dessine les schémas, calcule les composants, écrit le code et le compile. Il le téléverse sur la carte branchée et lit le moniteur série pour vérifier. Il faut arduino-cli : `winget install -e --id ArduinoSA.CLI`.

## Papiers et budget

- **Papiers** : dépose une facture, un avis ou un contrat (PDF, photo, scan) dans `Documents\Jarvis\papiers\a-classer`. Jarvis le lit, le range par année et par catégorie (`papiers\2026\Énergie et eau\2026-11-03_EDF_facture.pdf`), et crée un rappel trois jours avant l'échéance. « Quelles factures arrivent à échéance ? »
- **Budget** : exporte tes relevés de compte en CSV depuis le site de ta banque et dépose-les dans `Documents\Jarvis\budget\releves`. Jarvis classe chaque opération (courses, carburant, abonnements, simulation…) et fait le bilan du mois, comparé aux trois mois précédents. Il ne se connecte jamais à ta banque et ne connaît aucun identifiant bancaire.

## Travail : les noms de ton équipe restent chez toi

Mets tes documents de travail (plannings, exports d'indicateurs, comptes rendus) dans `Documents\Jarvis\travail`, et la liste de ton équipe dans `travail\equipe.txt` (un nom par ligne). Avant d'envoyer quoi que ce soit à Claude, Jarvis remplace leurs noms par « Conseiller A », « Conseiller B »…, puis remet les vrais noms à l'écran et à l'oral. Claude ne voit jamais qui est qui.

## Traçabilité, corbeille et sauvegardes

- « **Qu'as-tu fait aujourd'hui ?** » : chaque action de Jarvis est notée (commande, fichier, outil), y compris ce qui a été refusé.
- Avant de modifier un fichier, il en garde une copie : « remets la version d'hier de ce fichier ».
- Il ne supprime jamais directement : tout passe par la **corbeille de Windows**.
- **Chaque nuit**, une sauvegarde de sa mémoire, de tes projets, documents de travail, papiers et budget part dans `Documents\Jarvis\sauvegardes`. Il garde 14 jours et une sauvegarde par semaine sur 8 semaines. Pour une copie ailleurs (OneDrive, disque externe), règle `SAUVEGARDE_COPIE`.
- Tes mots de passe et jetons sont rangés dans un **coffre-fort chiffré par Windows** : au premier lancement, Jarvis les retire de `jarvis.env` (qui affiche alors `@coffre`). Pour en changer un, retape-le dans `jarvis.env`, il sera de nouveau rangé.

## IA locale (Ollama)

Installe [Ollama](https://ollama.com) puis un modèle (`ollama pull qwen3:14b`, par exemple). Si Claude est injoignable (coupure Internet, limite d'abonnement atteinte), Jarvis répond avec ce modèle, sans outils. Tu peux aussi lui confier des données très privées (« traite ça en local »). Pour tes recherches en IA, il compare des modèles sur un banc d'essai : vitesse, temps de réponse et réponses côte à côte, dans `Documents\Jarvis\ia\bancs`.

## Réglages : relier chaque élément

Ouvre la page **Réglages** (bouton ⚙ en haut, « ouvre les réglages », ou clic droit sur l'icône près de l'horloge). Chaque élément a sa carte avec ses champs et ses boutons :

| Carte | Ce que tu fais | Bouton |
|---|---|---|
| Toi et ta ville | Prénom, ville | Tester la météo |
| Ampoules et prises Tapo | E-mail et mot de passe de l'appli Tapo | Tester et lister mes appareils |
| Gmail et Google Agenda | ID client et code secret (le guide est sur la carte) | **Se connecter avec Google** |
| Spotify | Client ID de ton appli | **Connecter Spotify** |
| Réveil | **Parcourir…** pour choisir ton planning Excel, heures, lampes | Lire le planning, Essayer le réveil |
| Caméras | Nom et adresse IP, compte caméra | Tester (une image de chaque caméra s'affiche) |
| Alertes Telegram | Jeton du bot | **Trouver ma conversation**, Envoyer un essai |
| Voix, Travail, Cerveau, Sauvegardes | Voix, verrou vocal, équipe, IA locale, copie des sauvegardes | Apprendre ma voix, Tester l'IA locale, Sauvegarder, Chercher une mise à jour |

Les mots de passe vont directement dans le coffre-fort. Ce qui est marqué ↻ demande un redémarrage : un bouton « Redémarrer Jarvis » apparaît alors en haut. Le reste s'applique tout de suite. Sur la page Diagnostic, chaque point à corriger a un bouton qui ouvre la bonne carte des Réglages.

## Mises à jour

À chaque modification envoyée sur la branche `main` du dépôt GitHub **Jarvis**, GitHub fabrique un nouvel installateur et le publie dans l'onglet **Releases** (version 0.3.1, 0.3.2…). Le Jarvis installé sur ton PC vérifie toutes les 6 heures (et au bouton « Chercher une mise à jour »). Il télécharge la nouvelle version en arrière-plan, te prévient, et l'installe quand tu redémarres Jarvis. Tu n'as rien à réinstaller.

⚠️ Pour que ton PC puisse lire ces versions, le dépôt Jarvis doit être **public** (il ne contient aucun mot de passe ni donnée personnelle : tout ça reste sur ton PC). S'il reste privé, télécharge l'installateur à la main (Actions ou Releases), ou règle une autre adresse dans « Adresse de mise à jour ».

Si tu lances Jarvis depuis le code (`pnpm start`), mets à jour avec `git pull` puis `pnpm install`.

## Diagnostic

« **Jarvis, fais ton diagnostic** » ou la page Diagnostic. Il passe en revue :
- le cerveau, les oreilles, la voix et le verrou vocal ;
- le micro, les caméras, Google et Tapo ;
- Spotify, le planning et le prochain réveil ;
- les sauvegardes, le coffre-fort, l'IA locale, le labo et la bibliothèque ;
- l'espace disque.

Pour chaque point, il dit ce qui va, ce qui cloche et comment le corriger, avec des boutons comme « Connecter Spotify » ou « Apprendre ma voix ».

## Autonomie

Comme tu l'as demandé, Jarvis agit **sans demander de confirmation** quand l'action correspond à ta demande, puis te dit ce qu'il a fait. Il ne demande que si ta demande est ambiguë au point qu'il pourrait se tromper de cible.

Quelques limites restent bloquées par le code, même si tu les demandes à l'oral : une phrase mal entendue ne doit pas pouvoir effacer ton disque.
- Il ne peut pas formater un disque, toucher aux partitions ou au démarrage de Windows, supprimer les sauvegardes, désactiver l'antivirus ou le pare-feu.
- Il ne peut pas supprimer un disque entier ou un dossier système, ni modifier les fichiers de Windows. Toute suppression passe par la corbeille.
- Une voix qui n'est pas la tienne ne peut pas le faire agir (une fois ta voix apprise).
- Il n'exécute pas un script téléchargé sans le lire.
- Il ne tape jamais de numéro de carte bancaire ; les serrures et l'alarme demandent ton « oui ».
- Le contenu des mails, des pages web et des documents est une information, pas un ordre. Si un mail lui demande de payer ou d'envoyer quelque chose, il te le signale au lieu d'obéir.

Ces règles sont dans `src/shared/policy.ts`.

## Le cerveau : ton abonnement Claude

Comme Nitro70, Jarvis utilise le SDK officiel Claude Agent, connecté à **Claude Code sur ton PC**, donc à ton abonnement (Pro ou Max). Il n'y a pas de facturation à la question, mais l'usage compte dans les limites de ton abonnement : une journée très chargée peut les atteindre, et Jarvis te le dira.

⚠️ **À savoir :** les règles d'Anthropic prévoient la connexion par abonnement pour « l'usage ordinaire » de Claude Code et du SDK Agent par une personne, et une clé API pour les produits destinés à d'autres. Un assistant personnel pour toi seul n'est pas mentionné explicitement. Anthropic peut limiter un compte sans préavis. Si tu préfères la voie sans ambiguïté, mets une clé API dans les réglages (`ANTHROPIC_API_KEY`) : Jarvis l'utilise alors à la place, facturée à l'usage.

## Installation

### Le plus simple : l'installateur

Un installateur Windows (`Jarvis-0.3.x-installation.exe`) est fabriqué automatiquement sur GitHub, dans le dépôt **Jarvis** : onglet **Releases** (à droite de la page du dépôt), dernière version, fichier `.exe`. Il est aussi dans *Actions → Jarvis Windows → dernière exécution → Artifacts*. Lance-le, puis connecte Claude Code (`claude` dans un terminal, une fois). Windows affichera « Windows a protégé votre ordinateur » parce que l'installateur n'est pas signé : *Informations complémentaires → Exécuter quand même*.

Ensuite, il se met à jour tout seul (voir « Mises à jour »).

### Depuis le code

1. Récupère le code sur ton PC : sur la page GitHub du dépôt, *Code → Download ZIP*, puis décompresse-le, par exemple dans `C:\Jarvis`. Tu peux aussi utiliser GitHub Desktop.
2. Ouvre le dossier `apps\jarvis-desktop\windows`, fais un clic droit sur **installer.ps1** et choisis **Exécuter avec PowerShell**. Le script installe ce qu'il faut (Node.js, Python, Claude Code), te fait te connecter à ton compte Claude, puis crée les raccourcis « Jarvis » sur le bureau et dans le menu Démarrer.
   - Si Windows bloque le script, ouvre PowerShell et lance une fois `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
3. Au premier démarrage, autorise le micro et les caméras. Le modèle de reconnaissance vocale (environ 250 Mo) se télécharge une seule fois.
4. Clic droit sur l'icône près de l'horloge → **Réglages** : renseigne Tapo (e-mail et mot de passe de l'appli), et si tu veux Google et Home Assistant. Ensuite, quitte Jarvis et relance-le.
5. Clic droit sur l'icône → **Lancer au démarrage de Windows**.

Pour mettre à jour : récupère la nouvelle version du code, puis lance `windows\mettre-a-jour.ps1`.

## Réglages utiles (fichier `jarvis.env`)

| Réglage | Rôle |
|---|---|
| `JARVIS_VOICE` | La voix : `fr-FR-VivienneMultilingualNeural` (par défaut), `fr-FR-DeniseNeural`, `fr-FR-EloiseNeural` |
| `JARVIS_VOICE_RATE`, `JARVIS_VOICE_PITCH` | Vitesse (`+10%`) et hauteur (`-2Hz`) |
| `STT_MODEL` | Reconnaissance vocale : `auto` (par défaut : Whisper large-v3-turbo si ta carte graphique a 6 Go de mémoire ou plus, sinon whisper-small), ou un modèle précis |
| `STT_DEVICE` | `dml` (carte graphique, par défaut) ou `cpu` |
| `CONVERSATION_SECONDS` | Durée pendant laquelle il écoute sans le mot « Jarvis » |
| `BRIEFING_TIME` | Heure du briefing, ou `off` |
| `JARVIS_VILLE` | Ta ville, pour la météo |
| `WEBHOOK_SECRET` | Active le connecteur pour l'app Claude du téléphone et les SMS transférés (voir `apps/jarvis/README.md`) |
| `PLANNING_FICHIER`, `PLANNING_NOM`, `PLANNING_CODES` | Le planning de travail pour le réveil (voir « Le réveil du matin ») |
| `REVEIL`, `REVEIL_HEURE`, `REVEIL_JOURS`, `REVEIL_AVANT_TRAVAIL`, `REVEIL_REPOS`, `REVEIL_LUMIERES`, `REVEIL_MUSIQUE_APRES` | Réveil : `off` pour le couper, heure et jours sans planning, minutes avant le poste, jours de repos, lampes du lever de soleil, musique après le message (`continuer` ou `pause`) |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_REVEIL` | Ton appli Spotify, et une playlist de réveil choisie |
| `VOIX_SEUIL`, `VOIX_INVITES_MAISON` | Sévérité du verrou vocal ; `true` laisse une voix inconnue allumer les lumières |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Alertes de surveillance sur ton téléphone |
| `SURVEILLANCE`, `SURVEILLANCE_LUMIERES`, `SURVEILLANCE_MESSAGE`, `SURVEILLANCE_DISSUASION` | Mode au démarrage, dissuasion |
| `EQUIPE`, `TRAVAIL_DOSSIER`, `TRAVAIL_PSEUDONYMES` | Noms de l'équipe à masquer, dossier des documents de travail, `false` pour couper les pseudonymes |
| `OPENALEX_CLE`, `SEMANTIC_SCHOLAR_CLE`, `NCBI_CLE` | Clés (gratuites) des bases scientifiques |
| `BIBLIOTHEQUE_DOSSIER` | Autre dossier pour la bibliothèque |
| `OLLAMA_URL`, `IA_LOCALE_MODELE` | IA locale |
| `SAUVEGARDE_COPIE` | Second dossier pour les sauvegardes (OneDrive, disque externe) |
| `JEUX_PROCESSUS` | Autres jeux à détecter (nom du .exe) pour réserver l'écran du milieu |
| `MISE_A_JOUR_URL` | Adresse des mises à jour automatiques |

## Vie privée

- Le micro et les caméras sont analysés **sur ton PC** : la détection de la voix, des claquements et des gestes, ainsi que la transcription Whisper.
- Une image de l'écran ou des caméras n'est envoyée à Claude que quand Jarvis la regarde pour répondre. Le bouton « Caméras » coupe tout.
- La voix est générée par le service de lecture à voix haute de Microsoft Edge : le texte des réponses y transite. Si ce service ne répond pas, Jarvis passe cinq minutes sur la voix intégrée de Windows, puis réessaie.
- L'empreinte de ta voix, l'index de ta bibliothèque et la détection de personnes sur les caméras sont calculés sur ton PC.
- Les noms de ton équipe sont remplacés par des pseudonymes avant d'aller vers Claude.
- Les mots de passe sont chiffrés par Windows (coffre-fort), liés à ta session.
- Tes notes, ta mémoire et l'historique restent dans `%APPDATA%\Jarvis`. Les erreurs sont journalisées dans `erreurs.log`.

## Si quelque chose ne marche pas

- **« Je n'arrive pas à me connecter à Claude »** : ouvre un terminal, lance `claude` et connecte-toi.
- **Il ne t'entend pas** : vérifie *Paramètres Windows → Confidentialité → Microphone*, et que le bouton « Micro » est allumé.
- **La reconnaissance vocale est lente** : mets `STT_MODEL=onnx-community/whisper-base`. Si ta carte graphique n'est pas prise en charge, mets `STT_DEVICE=cpu`.
- **Les claquements ne marchent pas** : claque franchement, deux fois, à environ un tiers de seconde d'écart, près du micro. Un micro-casque à réduction de bruit filtre parfois les claquements.
- **« Gestes indisponibles »** : le modèle des gestes se télécharge au premier lancement, il faut donc Internet.

## Développement

```
src/main/main.ts           Fenêtres, icône près de l'horloge, raccourcis, voix ↔ cerveau
src/main/brain.ts          Claude par le SDK Agent (abonnement ou clé), session continue
src/main/persona.ts        Personnalité et méthodes de travail de Jarvis
src/main/desktop-tools.ts  Outils du PC : écran, caméras, PowerShell, souris, clavier, affichage
src/main/pc.ts             Contrôle de Windows par PowerShell (sans module natif)
src/main/voice.ts          Voix (Edge, repli Windows) et oreilles (Whisper local)
src/main/proactive.ts      Briefing, rappels, rendez-vous, mails importants
src/main/journal.ts        Journal de bord de tous les échanges, avec recherche
src/main/racing/           Ingénieur de course : télémétrie F1 (UDP), Le Mans Ultimate (API locale), annonces, bilan
src/shared/audio.ts        Détection de la voix et du double claquement
src/shared/wake.ts         Mot de réveil « Jarvis » et fenêtre de conversation
src/shared/policy.ts       Limites dures de l'autonomie
src/main/pages/            Pages, écrans (gauche, centre, droite) et commandes « ouvre / ferme / mets »
src/main/weather.ts        Météo (Open-Meteo)
src/main/perf.ts           Performances du PC (systeminformation)
src/main/security.ts       Caméras Tapo (RTSP → ffmpeg), détection de mouvement, diffusion locale
src/main/project-view.ts   Projets affichés sur les pages Code et R&D, avec mise à jour en direct
src/main/pages/layout.ts   Placement des pages : moitiés, tiers, un écran par page, écran du jeu libre
src/main/pages/dispositions.ts  Dispositions (course, atelier, bureau…) modifiables
src/main/games.ts          Détection du jeu en cours (processus Windows)
src/main/reveil/           Réveil : planning Excel, heure du réveil, Spotify, déroulé
src/main/morning.ts        Message du matin
src/main/plus-tools.ts     Deuxième boîte à outils (chargée à la demande par Claude)
src/main/tasks.ts          Tâches de fond
src/main/voiceprint.ts     Verrou vocal (empreinte WavLM)
src/main/vault.ts          Coffre-fort (chiffrement Windows)
src/main/backup.ts         Sauvegardes quotidiennes
src/main/actions.ts        Journal des actions, copies avant modification, corbeille
src/main/privacy.ts        Pseudonymes de l'équipe ; workfiles.ts : lecture des documents de travail
src/main/research/         Littérature scientifique, recherche approfondie
src/main/library/          Bibliothèque : extraction PDF/Word, index hybride
src/main/learning.ts       Mode mentor, parcours, révisions espacées
src/main/lab.ts            Labo Python (assets/labo/jarvis_labo.py : boîte à outils)
src/main/veille.ts         Veille (flux RSS/Atom)
src/main/routines.ts       Routines et minuteurs
src/main/garage.ts, obd.ts, serial.ts  Carnet d'entretien, OBD ELM327, port série
src/main/procedures.ts     Procédures apprises par démonstration
src/main/local-ai.ts       IA locale (Ollama) et banc d'essai
src/main/electronics.ts    Arduino / ESP32 (arduino-cli)
src/main/papers.ts, budget.ts  Papiers et budget
src/main/diagnostic.ts     Bilan de santé
src/shared/intents.ts      Réflexes (commandes traitées sans Claude)
src/shared/gestures.ts     Main ouverte : stop et balayages
src/renderer/pages/        Accueil, Ingénieur, Travail, Code, R&D, Sécurité, Performances, Diagnostic, bulle
src/renderer/senses.ts     Micro, claquements, voix, sonnerie, webcams, gestes, détection de personnes (accueil)
```

`pnpm dist` fabrique l'installateur Windows (sous Windows). Le workflow `.github/workflows/jarvis-windows.yml` le fait sur GitHub.

`pnpm start` assemble et lance Jarvis. `pnpm test` lance les tests, `pnpm typecheck` vérifie les types.

## Organisation du code (processus principal)

`src/main/main.ts` est la colonne vertébrale : il crée les services (vault, réglages, cerveau, voix, oreilles, maison, pages…), relie les messages de l'interface et lance Jarvis. Les grandes fonctions vivent dans des modules qui reçoivent explicitement les services dont ils ont besoin (interface `JarvisServices`) :

| Module | Rôle |
| --- | --- |
| `diagnostic-checks.ts` | contrôles de la page Diagnostic |
| `settings-actions.ts` | boutons de la page Réglages (tester, connecter, installer, restaurer) |
| `pc-care.ts` | santé du PC, puce graphique de l'interface, mode jeu |
| `pc-health.ts` | collecte et analyse de la santé du PC (journaux Windows, carte NVIDIA) |
| `intent-actions.ts` | réflexes : demandes simples exécutées sans Claude |
| `routine-runner.ts` | exécution des routines (« bonne nuit », « je pars »…) |
| `plus-host.ts` | ce que les outils supplémentaires de Claude peuvent faire sur le PC |
| `updates.ts` | mises à jour automatiques |
| `music-panel.ts` | module Musique de l'accueil |
| `hardware.ts` | profil matériel et réglages adaptés au PC |
| `watchdog.ts` | veilleur des connexions |

Chaque publication passe par : vérification des types, tests, puis lancement réel de Jarvis sous Windows (`JARVIS_TEST_DEMARRAGE`) avant d'être publiée.
