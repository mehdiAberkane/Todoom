# 💀 Todoom

Gestionnaire de tickets façon kanban, pour Windows et macOS (Tauri 2 + React).
Les données sont des petits fichiers JSON dans un dossier Google Drive synchronisé,
ce qui permet de retrouver ses tableaux sur tous ses PC.

## Lancer

```bash
npm install
npm run tauri dev      # l'app de bureau (nécessite Rust)
npm run dev            # l'interface seule dans le navigateur, données en localStorage
npm run tauri build    # installeur (.msi/.exe sur Windows, .dmg/.app sur macOS)
```

L'installeur macOS doit être construit sur un Mac.

## Stockage

Au premier lancement, choisis le dossier de données (par ex. `G:\Mon Drive\Todoom`,
ou `~/Library/CloudStorage/GoogleDrive-…/Mon Drive/Todoom` sur Mac). Le chemin est
mémorisé par machine.

```
Todoom/
  boards/<idTableau>/board.json         colonnes, étiquettes, nom
  boards/<idTableau>/cards/<idCarte>.json
  settings.json                         paramètres partagés (fond d'écran)
  .presence/<nomDuPC>.json              « aussi ouvert sur… »
```

Le format de chaque fichier est décrit dans [`schema/`](schema/) (schémas JSON) pour les
scripts et agents qui écrivent dans le dossier. Un fichier illisible ou d'un format
inattendu n'est pas affiché : il est listé dans la barre latérale (« ⚠ fichiers
ignorés ») avec la raison, et Todoom ne l'écrase jamais.

- Un fichier par carte : un conflit de synchro ne touche qu'une carte, et les copies
  de conflit de Drive (`xxx (1).json`) sont fusionnées en gardant la plus récente.
- Les cartes ont un `order` décimal : déplacer une carte ne réécrit que cette carte.
- L'app surveille le dossier et se recharge quand un autre PC modifie quelque chose
  (plus un rafraîchissement toutes les 2 min et au retour sur la fenêtre).

## Commande `todoom` et serveur MCP

Pour les scripts, l'agent et Claude : `todoom cards Todoom --column "à faire"`,
`todoom move <carte> "en cours"`, `todoom comment <carte> "…"`… en JSON, avec les
mêmes vérifications que l'application. `todoom mcp` offre les mêmes opérations comme
outils MCP. Installation et détail : [`docs/commande-todoom.md`](docs/commande-todoom.md).

## Publier une version

`npm run release` (ou `minor`, `major`, `x.y.z`) monte la version, crée le tag et le
pousse ; GitHub Actions construit Windows + macOS, signe et publie la Release, que
Todoom propose d'installer. La clé de signature, sa sauvegarde et son remplacement :
[`docs/cle-de-signature.md`](docs/cle-de-signature.md).
Les installeurs ne sont pas signés par Windows ni Apple : alerte à la première installation
seulement, pas lors des mises à jour (étude et coûts :
[`docs/signature-installeurs.md`](docs/signature-installeurs.md)).

## Sécurité

Signaler une faille : [`SECURITY.md`](SECURITY.md).

## Licence

[MIT](LICENSE).
