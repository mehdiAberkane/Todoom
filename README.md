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
  .presence/<nomDuPC>.json              « aussi ouvert sur… »
```

- Un fichier par carte : un conflit de synchro ne touche qu'une carte, et les copies
  de conflit de Drive (`xxx (1).json`) sont fusionnées en gardant la plus récente.
- Les cartes ont un `order` décimal : déplacer une carte ne réécrit que cette carte.
- L'app surveille le dossier et se recharge quand un autre PC modifie quelque chose
  (plus un rafraîchissement toutes les 30 s et au retour sur la fenêtre).
