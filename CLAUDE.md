# Consignes pour Claude sur ce dépôt (Jarvis)

Alex (le propriétaire) parle français et se fait tutoyer. Réponds en français.

## Publication : fusion automatique sur `main`

Alex a donné son accord **une fois pour toutes** : après chaque changement
vérifié, **fusionne sur `main` et pousse, sans lui redemander**. Le workflow
`jarvis-windows.yml` fabrique alors l'installateur et le publie ; les Jarvis
installés se mettent à jour seuls.

Marche à suivre, à chaque changement :

1. Travaille sur la branche de développement indiquée par la session.
2. Vérifie : `pnpm -r typecheck`, `pnpm -r test`, et pour un changement de
   l'application `node build.mjs` puis le test de démarrage
   (`JARVIS_TEST_DEMARRAGE=1 xvfb-run -a electron . --no-sandbox`).
3. Si tout est vert : commit, pousse la branche, puis
   `git checkout main && git merge --ff-only <branche> && git push origin main`.
4. Vérifie que le build Windows s'est lancé, puis **dis à Alex en une phrase**
   ce qui est parti et quelle version sort.

Ne fusionne **pas** (et dis-le à Alex) si : un test ou le typecheck échoue, le
test de démarrage échoue, ou le changement n'a pas pu être vérifié. Ne force
jamais (`--force`), ne réécris pas l'historique de `main`. Si Alex écrit « stop »
ou « ne fusionne plus », reviens à demander avant chaque fusion.

Le hook « branche non poussée » se trompe parfois à cause du renommage du dépôt
en `Jarvis` : vérifie avec `git ls-remote --heads origin <branche>` avant de
conclure qu'un push manque.

## À savoir sur le code

- Monorepo pnpm : `apps/jarvis-desktop` (le logiciel Windows, Electron) et
  `apps/jarvis` (cœur partagé).
- Tout texte visible par Alex est en français ; les erreurs sont expliquées.
- Rien de personnel ni de secret dans les commits ou les journaux.
- Les réglages, mots de passe et connecteurs ne doivent jamais être accessibles
  depuis le téléphone (voir `docs/telephone.md`).
