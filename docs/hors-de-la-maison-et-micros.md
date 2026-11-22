# Jarvis hors de la maison, et micros dans les autres pièces

Deux choses qui se complètent. Les deux sont **en place dans Jarvis** ; ce qui
dépend de matériel ou de comptes extérieurs est dit clairement.

## 1. Joindre Jarvis de n'importe où (Tailscale)

**Le problème.** Les données de ta montre (« Ma forme ») et les micros des
autres pièces parlent à Jarvis sur le Wi-Fi de la maison. Dès que tu es en 4G,
ça ne passe plus.

**La solution propre : Tailscale.** C'est un réseau privé chiffré entre tes
appareils (gratuit pour un usage personnel). Pas de port à ouvrir sur ta box,
rien d'exposé sur Internet.

1. Installe Tailscale sur le **PC** et sur le **téléphone**, avec le même compte.
2. Redémarre Jarvis. Il détecte l'adresse Tailscale (de la forme `100.x.x.x`) et
   l'affiche : page **Ma forme** (« Depuis n'importe où »), et dans les boutons
   « Voir l'adresse » des réglages Santé et Micros des autres pièces.
3. Dans l'appli du téléphone, mets cette adresse au lieu de celle de la maison.

À savoir : le PC doit être allumé ; Tailscale est un service tiers (compte
requis). **Telegram marche déjà partout**, sans rien installer.

## 2. Micros dans les autres pièces

**Principe.** Jarvis ne fournit que le **cerveau**. Le micro fait la
reconnaissance vocale (transformer ta voix en texte) et la synthèse vocale
(lire la réponse), puis parle à Jarvis par une petite porte HTTP :

```
POST http://<adresse>:8895/demande
En-tête : x-jeton: <jeton affiché dans Réglages>
Corps    : {"texte": "quelle heure est-il ?", "piece": "cuisine"}
Réponse  : {"reponse": "Il est midi dix."}
```

Activation : Réglages → **Micros des autres pièces** → « Oui », enregistrer,
redémarrer Jarvis, puis « Voir l'adresse pour le micro ».

**Ce que le micro a le droit de faire.** Par défaut : **questions seulement**
(météo, culture, calculs…). Pas d'action sur la maison, le PC ou les mails. La
raison : Jarvis ne peut pas reconnaître ta voix à travers un micro distant, donc
une personne près du micro (invité, télé) pourrait donner des ordres. Tu peux
passer à « Agir comme si c'était toi » si tu fais confiance à la pièce.

**Quel matériel ?** (rien n'est fourni avec Jarvis)

| Option | Coût indicatif | Remarque |
| --- | --- | --- |
| Home Assistant Voice Preview Edition | ~60 € | Le plus simple, fait micro, haut-parleur et reconnaissance |
| Module ESP32-S3 avec micro et haut-parleur | ~15–30 € | Plus bricolage |
| Un vieux téléphone avec une page web ou une appli qui envoie du texte | 0 € | Pour tester |

**Ce qui n'a PAS été testé.** Le serveur de Jarvis est testé (jeton, réponse,
erreurs, limite de taille). Mais je n'ai pas pu essayer avec un vrai micro ni
avec Home Assistant : le raccordement côté micro (par exemple une commande
`rest_command` dans Home Assistant qui appelle l'adresse ci-dessus, déclenchée
par un pipeline Assist) est à valider chez toi. Dis-moi ce que tu choisis et
j'écris le raccordement exact.
