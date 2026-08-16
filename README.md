# Undercover — distributeur de mots

Application web (PWA) qui **distribue secrètement les mots** d'une partie d'Undercover autour d'un seul téléphone qui passe de main en main. Les débats, les votes et les éliminations se jouent à l'oral : l'app ne fait que la distribution.

👉 **Jouer / installer : https://coachccai-blip.github.io/undercover/**

Sur mobile : ouvrir le lien, puis « Ajouter à l'écran d'accueil ». L'application fonctionne ensuite **100 % hors-ligne**.

---

## Fonctionnalités

- 3 à 20 joueurs, noms éditables, 1 à *n* undercovers (toujours strictement moins de la moitié des joueurs, réajusté automatiquement).
- **2 000 paires de mots bilingues FR/EN**, réparties en 10 thématiques de 200 paires.
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
words.js        banque des 2 000 paires bilingues
manifest.json   PWA (nom, icônes, standalone, portrait)
sw.js           service worker (cache complet hors-ligne)
icons/          logo vectoriel + icônes PNG 192/512 + maskable
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

## Logo

Le logo (`icons/logo.svg`) est une version vectorielle du raton laveur encapuchonné, qui sert aussi de base aux icônes PWA. Pour utiliser le fichier original à la place :

1. déposer l'image dans `icons/logo.png` ;
2. remplacer `icons/logo.svg` par `icons/logo.png` dans `index.html` (deux occurrences), `manifest.json` et `sw.js` ;
3. régénérer si besoin `icon-192.png`, `icon-512.png` et `icon-maskable-512.png` aux mêmes dimensions.

## Hors périmètre (V1)

Pas de rôle Mr. White, pas de gestion des votes ni des éliminations, pas de score, pas de multi-téléphones, pas de paires personnalisées.
