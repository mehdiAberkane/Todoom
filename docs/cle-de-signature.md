# Clé de signature des mises à jour

Chaque Todoom installé contient la **clé publique** (`plugins.updater.pubkey` dans
`src-tauri/tauri.conf.json`) et n'installe une mise à jour que si elle est signée par
la **clé privée** correspondante.

| Élément | Où |
|---|---|
| Clé privée | `~/.tauri/todoom.key` (hors du dépôt) et secret GitHub `TAURI_SIGNING_PRIVATE_KEY` de l'environnement `release` |
| Mot de passe | `~/.tauri/todoom.key.password.txt` et secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` de l'environnement `release` |
| Clé publique | `~/.tauri/todoom.key.pub` et `src-tauri/tauri.conf.json` |

## Où vivent les secrets : l'environnement `release`

Un secret **de dépôt** est lisible par tout workflow, depuis n'importe quelle branche
poussée par un compte qui a le droit d'écrire. Les deux secrets de signature vont donc
dans l'**environnement** `release` (Settings → Environments → release) :

- seuls les tags `v*` peuvent y entrer (« Deployment branches and tags » : tag `v*`) ;
- le job `build` de `.github/workflows/release.yml` le déclare (`environment: release`) ;
- un workflow lancé depuis une branche est refusé à l'entrée de l'environnement, et ne
  voit pas ces secrets.

Les mettre en place (ou les remplacer), depuis le dossier du dépôt :

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY --env release < ~/.tauri/todoom.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --env release < ~/.tauri/todoom.key.password.txt
gh secret list --env release
```

Puis supprimer les secrets **de dépôt** du même nom (Settings → Secrets and variables →
Actions → Repository secrets), sinon la protection ne sert à rien : un job sans
environnement les lirait encore.

```bash
gh secret delete TAURI_SIGNING_PRIVATE_KEY
gh secret delete TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Garde une copie de `~/.tauri/` dans un gestionnaire de mots de passe : sans elle, plus
aucune mise à jour automatique n'est possible.

## Principe du remplacement

Une installation ne connaît que la clé publique avec laquelle elle a été construite.
Pour changer de clé sans réinstaller à la main, on publie une **version de transition**
qui contient la nouvelle clé publique mais qui est encore **signée avec l'ancienne** :
les installations l'acceptent, et à partir de là elles font confiance à la nouvelle clé.

## Remplacement préventif (clé non compromise)

1. Générer la nouvelle paire :
   ```bash
   npx tauri signer generate -w ~/.tauri/todoom-2.key -p "<nouveau mot de passe>" --ci
   ```
2. Mettre le contenu de `~/.tauri/todoom-2.key.pub` dans `plugins.updater.pubkey` de
   `src-tauri/tauri.conf.json`, commiter.
3. Publier la version de transition **sans toucher aux secrets GitHub** :
   `npm run release`. Elle est signée avec l'ancienne clé.
4. Installer cette version sur **chaque** PC et Mac (bouton de mise à jour), vérifier
   le numéro dans la barre de titre.
5. Remplacer les deux secrets de l'environnement `release` par la nouvelle clé et son
   mot de passe (commandes `gh secret set … --env release` ci-dessus, ou Settings →
   Environments → release → crayon → Update secret).
6. Publier une version de test : l'étape « Check update signing secrets » doit passer,
   et la mise à jour doit s'installer.
7. Remplacer `~/.tauri/todoom.key*` par les nouveaux fichiers, mettre à jour la copie
   de sauvegarde, puis effacer l'ancienne clé.

## Clé ou mot de passe exposés

Avec la clé, quelqu'un peut signer une mise à jour acceptée par tes installations ; il
lui faut encore la publier là où Todoom la cherche (les Releases du dépôt GitHub), donc
une fuite va souvent avec un accès au compte GitHub. Dans l'ordre :

1. **Sécuriser GitHub** : changer le mot de passe, révoquer les jetons et sessions
   inconnus, vérifier les collaborateurs, les clés SSH et les secrets du dépôt.
2. **Supprimer toute Release que tu n'as pas publiée toi-même**, et le tag associé.
3. Suivre le remplacement préventif ci-dessus **tout de suite** (étapes 1 à 7) : la
   version de transition est la course contre une version piégée.
4. Sur un poste dont la version installée ne correspond pas à une Release que tu as
   publiée : le considérer comme compromis, désinstaller, réinstaller depuis un
   installeur que tu as construit toi-même (`npm run tauri build`).

## Clé perdue

Sans l'ancienne clé, aucune version de transition n'est possible : générer une
nouvelle paire (étapes 1, 2, 5), publier, puis **réinstaller à la main** la nouvelle
version sur chaque poste. Les mises à jour automatiques reprennent ensuite.

## Protections GitHub conseillées

En place : l'environnement `release`, limité aux tags `v*` (ci-dessus).

Pas encore en place (choix de l'utilisateur, à ajouter s'il le décide) :

- **Règles d'étiquettes** (Settings → Rules → Rulesets) sur `refs/tags/v*` : seules
  les créations par toi, pas de suppression ni de déplacement d'un tag publié.
- **Règles de branche** sur `main` : pas de suppression ni de réécriture de l'historique
  (`force push`).
- Les actions du flux de publication sont épinglées par empreinte de commit ;
  Dependabot propose les mises à jour (`.github/dependabot.yml`). Lire ce qui change
  dans une action avant d'accepter sa mise à jour.
