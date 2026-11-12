# J.A.R.V.I.S.

Assistant IA personnel d'Alex pour Windows : voix, gestes, caméras, maison Tapo, mails et agenda, réveil, ingénieur de course (Le Mans Ultimate, F1), recherche, labo de calcul, R&D, travail, budget.

| Dossier | Contenu |
|---|---|
| `apps/jarvis-desktop` | **Le logiciel Windows** (Electron). Guide complet : [apps/jarvis-desktop/README.md](apps/jarvis-desktop/README.md) |
| `apps/jarvis` | Le serveur Jarvis (Telegram, connecteur pour l'app Claude du téléphone) et les outils partagés |

**Installer** : onglet **Releases** → dernière version → `Jarvis-…-installation.exe`. Il se met ensuite à jour tout seul.

**Depuis le code** :
```
pnpm install
pnpm start     # lance Jarvis
pnpm test      # tests
pnpm dist      # fabrique l'installateur (sous Windows)
```
