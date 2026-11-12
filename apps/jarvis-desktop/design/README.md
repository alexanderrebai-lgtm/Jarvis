# Pistes de design

Quatre maquettes à comparer, à ouvrir dans un navigateur. Elles sont statiques, avec des données d'exemple, sauf les animations.

- `1-cockpit.html` : l'écran d'un volant de LMH ou de F1. Fond carbone, LED de régime qui suivent la voix, gros chiffres, orange et rouge.
- `2-monolithe.html` : radicalement minimal et chaleureux, comme l'IA du film *Her*. La réponse en grand, une ligne vivante qui ondule, des cartes qui n'apparaissent que si elles sont utiles.
- `3-arc-spatial.html` : on est « dans » l'interface. Des panneaux de verre en arc autour de toi, un noyau d'anneaux en 3D, un sol en perspective.
- `4-signal.html` : noir absolu et matrice de points, façon Nothing. Un « visage » de points qui s'allume quand Jarvis parle, des tuiles arrondies, du rouge pour l'essentiel.

Polices : Inter, Space Grotesk, JetBrains Mono, Instrument Serif et Doto (licence SIL Open Font).

Choix retenu : un HUD façon Iron Man, avec Jarvis (le réacteur) au centre de chaque page et des cartes nettes reliées par des lignes de flux. La page Ingénieur reprend la maquette Cockpit. Voir `src/renderer/styles.css` et `src/renderer/hud.ts`.
