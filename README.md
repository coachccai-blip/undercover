# Undercover — distributeur de mots

Application web (PWA) qui **distribue secrètement les mots** d'une partie d'Undercover autour d'un seul téléphone qui passe de main en main. Les débats, les votes et les éliminations se jouent à l'oral : l'app ne fait que la distribution.

👉 **Jouer / installer : https://coachccai-blip.github.io/undercover/**

Sur mobile : ouvrir le lien, puis « Ajouter à l'écran d'accueil ». L'application fonctionne ensuite **100 % hors-ligne**.

---

## Fonctionnalités

- 3 à 20 joueurs, noms éditables, 1 à *n* undercovers (toujours strictement moins de la moitié des joueurs, réajusté automatiquement).
- **2 000 paires de mots trilingues** (français, anglais, 中文), réparties en 10 thématiques de 200 paires. Chaque carte affiche le mot en français en grand, puis « English / 中文 » en sous-titre.
- **Aucune répétition** : une paire jouée ne ressort plus tant que son périmètre n'est pas épuisé. Le statut est conservé dans le `localStorage` du téléphone, y compris entre deux sessions. Quand une thématique est terminée, elle se réinitialise seule (message discret).
- Attribution civil/undercover du mot **tirée au sort à chaque partie** (50/50), rôles **redistribués** à chaque lancement, y compris sur « Rejouer ».
- Deux options facultatives : *les undercovers savent qu'ils le sont* et *les undercovers se connaissent* (la seconde active implicitement l'affichage du rôle pour les undercovers).
- Sécurité anti-triche : bouton retour du navigateur neutralisé pendant la distribution, mot jamais affiché sans action explicite, effacement du mot avant tout changement d'écran.
- PWA complète : `manifest.json`, service worker, mode portrait, thème sombre.

## Thématiques

| # | Thématique | Paires |
|---|---|---|
| 1 | Nourriture & Boissons | 200 |
| 2 | Animaux & Nature | 200 |
| 3 | Objets du quotidien | 200 |
| 4 | Métiers & Personnages | 200 |
| 5 | Sports & Loisirs | 200 |
| 6 | Voyages & Lieux | 200 |
| 7 | Cinéma, Séries & Musique | 200 |
| 8 | Sciences & Technologie | 200 |
| 9 | Émotions & Concepts abstraits | 200 |
| 10 | Vie quotidienne & Société | 200 |
| | **Total** | **2 000** |

Le mode « Tout » tire parmi les 2 000 paires, en partageant le même historique que les modes thématiques.

## Structure du projet

```
index.html      écrans de l'app (SPA légère, show/hide)
styles.css      thème sombre bleu nuit / acier, mobile-first
app.js          logique : configuration, tirage, rôles, persistance
words.js        banque des 2 000 paires trilingues FR/EN/中文
manifest.json   PWA (nom, icônes, standalone, portrait)
sw.js           service worker (cache complet hors-ligne)
icons/          logos PNG (undercover, civil) + icônes PWA 192/512/maskable
```

Aucun framework, aucune étape de build : les fichiers sont servis tels quels.

## Développement local

```bash
npx http-server -p 8123 -c-1
# puis ouvrir http://127.0.0.1:8123
```

Le service worker exige HTTPS ou `localhost` — c'est le cas sur GitHub Pages comme en local.

Après modification d'un fichier mis en cache, incrémenter `CACHE_NAME` dans `sw.js` pour forcer la mise à jour chez les joueurs.

## Publication

Le site est publié par GitHub Pages depuis la branche `main` (racine du dépôt). Tout push sur `main` met l'application à jour en ligne au bout d'une minute environ.

## Logos

Les visuels du jeu sont les logos officiels fournis :

- `icons/logo-undercover.png` — raton laveur encapuchonné : écran d'accueil, écran de passage, badge UNDERCOVER, et base des icônes PWA (`icon-192`, `icon-512`, `icon-maskable-512`).
- `icons/logo-civil.png` — panda roux : badge CIVIL sur l'écran de révélation.

Les fichiers sont rééchantillonnés en 512 × 512 à partir des originaux 1254 × 1254 pour rester légers en cache hors-ligne. Pour les remplacer, déposer de nouveaux PNG carrés aux mêmes noms puis incrémenter `CACHE_NAME` dans `sw.js`.

## Hors périmètre (V1)

Pas de rôle Mr. White, pas de gestion des votes ni des éliminations, pas de score, pas de multi-téléphones, pas de paires personnalisées.
