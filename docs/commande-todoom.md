# La commande `todoom` et le serveur MCP

Pour que les scripts, l'agent et les conversations Claude lisent et modifient les
tableaux sans écrire les fichiers JSON à la main. Les deux passent par le même code
([`cli/store.ts`](../cli/store.ts)) et suivent les règles de l'application :

- chaque carte écrite est vérifiée comme l'application le fait au chargement ;
- écriture atomique (fichier temporaire puis renommage) : ni l'application ni Drive
  ne voient un fichier à moitié écrit ;
- `updatedAt` avance toujours, même depuis un PC dont l'horloge retarde, pour gagner
  face aux copies de conflit de Drive ;
- une carte créée ou déplacée va en bas de sa colonne, comme dans l'application ;
- un fichier illisible est ignoré, jamais écrasé.
- sur un même ordinateur, deux écritures (deux conversations Claude, un script) passent l’une après l’autre : un verrou local les sépare (dans le dossier des réglages de Todoom, pas dans Drive). Juste avant d’écrire une carte, elle est relue : si elle a changé entre-temps (par l’application, par exemple), l’opération est refaite sur la version à jour. Une prise de carte (`claim`) est alors refusée si quelqu’un l’a prise entre-temps.

Entre deux ordinateurs, ce verrou ne sert pas : Drive met quelques secondes à porter chaque fichier. Deux cartes créées au même moment sur deux ordinateurs peuvent recevoir le même numéro ; l’application en renumérote une, et la référence donnée par la commande (`TOD-12`) peut alors changer.

L'application ouverte voit les changements d'elle-même, en quelques secondes.

## Installer

Depuis le dépôt (Node 22 ou plus) :

```
npm ci
npm run cli:install
```

`cli:install` construit `dist-cli/todoom.mjs`, un seul fichier sans dépendance, et
le déclare comme commande `todoom` (`npm link`). Sans l'installer, on peut aussi
lancer `node dist-cli/todoom.mjs …`. Après une mise à jour du dépôt, relancer
`npm run cli:install`.

Le dossier de données est celui choisi dans l'application. On peut en indiquer un
autre avec `--dir <dossier>` ou la variable `TODOOM_DIR`.

## Commandes

Toutes répondent en JSON sur la sortie standard. En cas d'erreur, la commande
renvoie le code 1 et `{"error": "…"}` sur la sortie d'erreur, avec la liste des
noms possibles quand un nom n'est pas reconnu.

| Commande | Effet |
|---|---|
| `todoom boards [--all]` | tableaux, colonnes, étiquettes et niveaux de priorité (`--all` : corbeille comprise) |
| `todoom board <tableau> [--description <texte>]` | un tableau et sa page de contexte (dépôt, règles, vocabulaire, sens des colonnes), à lire avant de prendre un ticket ; `--description` la remplace |
| `todoom new-board <nom> [--template dev|simple|<tableau>] [--description <texte>] [--repo <adresse>]` | nouveau tableau, comme dans l’application : modèle « dev » par défaut (À faire, En cours, A verifier, Terminé, Backlog et leurs étiquettes), « simple », ou la configuration d’un tableau existant ; clé des cartes donnée tout de suite ; refusé si le nom existe déjà |
| `todoom cards <tableau> [--column <nom>] [--search <texte>] [--archived \| --waiting]` | cartes, colonne par colonne, sans description ; la prochaine carte d'une routine n'y est qu'à partir de quelques jours avant son échéance (`--waiting` liste celles qui attendent) |
| `todoom checklist <carte> [--add <texte>]… [--check <élément>]… [--uncheck <élément>]… [--remove <élément>]…` | coche, décoche, ajoute ou retire des éléments de la checklist ; un élément se désigne par sa position (1 = le premier), son identifiant ou le début unique de son texte |
| `todoom search <texte> [--archived]` | cartes de tous les tableaux dont le titre ou la description contient le texte |
| `todoom mine [--conversation <nom>]` | cartes prises par cet ordinateur, tous tableaux confondus (avec `--conversation`, seulement celles de cette conversation) : pour reprendre un travail interrompu |
| `todoom next <tableau> [--column <nom>]` | la carte à prendre : la première de « À faire » dans l'ordre affiché, que personne ne tient et qui ne dépend d'aucune carte non terminée ; `null` s'il n'y en a pas |
| `todoom show <carte>` | une carte entière, avec ses commentaires, son historique et ses liens (titre, tableau, colonne, terminée ou non) |
| `todoom create <tableau> <titre> [--column <nom>] [--description <texte>] [--label <nom>]… [--priority <nom>] [--due AAAA-MM-JJ]` | nouvelle carte, par défaut dans la première colonne |
| `todoom update <carte> [--title …] [--description …] [--append …] [--label …]… [--unlabel …]… [--priority … \| --no-priority] [--due … \| --no-due] [--branch … \| --no-branch] [--mr <adresse>] [--mr-state open\|merged\|closed] [--no-mr] [--repeat day\|week\|month \| --no-repeat]` | modifie les champs donnés, garde les autres ; une merge request garde son état quand son adresse change ; `--no-repeat` arrête une routine |
| `todoom move <carte> --before <carte>` / `--after <carte>` | juste avant ou après une autre carte du même tableau, dans sa colonne (dans une colonne triée par priorité…, seulement parmi les cartes à égalité) |
| `todoom move <carte> <colonne> [--top] [--board <tableau>]` | déplace en bas (ou en haut) d'une colonne ; avec `--board`, vers un autre tableau : même identifiant interne, étiquettes et priorité par leur nom, commentaires, historique et pièces jointes déplacés, nouveau numéro |
| `todoom link <carte> <type> <autre carte>` | lie deux cartes, même sur deux tableaux, et écrit le lien sur les deux. Types : `depends-on`, `blocks`, `duplicate-of`, `duplicated-by`, `relates-to`. Refusé s'il ferait s'attendre deux cartes l'une l'autre (cycle de dépendances) |
| `todoom unlink <carte> <autre carte>` | retire le lien des deux cartes |
| `todoom claim <carte> [--move <colonne>] [--conversation <nom>] [--force]` | prend le ticket (« Pris par » : ce PC, l'agent, la conversation), en le déplaçant au passage ; refusé s'il est pris par quelqu'un d'autre |
| `todoom release <carte> [--force]` | libère le ticket ; seul celui qui l'a pris peut le libérer, sauf `--force` |
| `todoom branch <carte> [--save]` | nom de la branche du ticket, en texte seul : celui de la carte, sinon celui que propose le format du tableau (`feat/TOD-51-titre` par défaut, réglable dans la page de contexte) ; `--save` l’enregistre sur la carte. Ex. : `git switch -c $(todoom branch TOD-51 --save)` |
| `todoom comment <carte> <texte>` | ajoute un commentaire daté, signé du nom du PC (et de l'agent avec `--as` ou `TODOOM_AGENT`) |
| `todoom archive <carte>` / `todoom restore <carte>` | archive, ou remet en bas de sa colonne |
| `todoom mcp` | lance le serveur MCP |

- **Noms** : tableaux, colonnes, étiquettes et priorités se désignent par leur nom. Casse et
  accents sont ignorés, et un début de nom suffit s'il est unique :
  `todoom move <carte> "en cours"`.
- **Cartes** : par leur identifiant court (`SOL-42`, casse ignorée), leur identifiant, ou un début unique d'au moins 4 caractères de celui-ci. Les réponses donnent l'identifiant court dans `ref`.
- **Liens** : une carte qui dépend d'une carte non terminée est marquée « Bloquée » sur le tableau. Une carte compte comme terminée quand elle est archivée ou dans une colonne nommée « Terminé », « Done », « Fait »…
- **Texte long** : `-` à la place du texte le lit sur l'entrée standard :
  `Get-Content rapport.md | todoom comment <carte> -`.

Chaque modification faite par la commande ou le serveur MCP est inscrite dans
l'historique de la carte, comme celles faites dans l'application. `show` et
`get_card` renvoient les commentaires et l'historique. Pour signer : `--as <agent>`
ou la variable `TODOOM_AGENT` (le serveur MCP signe « Claude » par défaut), et
`TODOOM_CONVERSATION` pour la conversation.

## Serveur MCP pour Claude

`todoom mcp` expose les mêmes opérations comme outils : `list_boards`, `get_board`, `create_board`, `update_board`, `list_cards`,
`get_card`, `create_card`, `update_card`, `move_card` (aussi `before` / `after`), `update_checklist`, `search_cards`, `my_cards`,
`next_card`, `claim_card`, `release_card`, `link_cards`, `unlink_cards`, `add_comment`, `archive_card`, `restore_card`.

Pour Claude Code, une fois pour toutes sur chaque PC :

```
claude mcp add --scope user todoom -- node C:\xampp\htdocs\Todoom\dist-cli\todoom.mjs mcp
```

Sur Mac, mettre le chemin du dépôt sur ce Mac. Le chemin complet vers `node` et le
fichier évite les soucis de `PATH` et de `.cmd` sous Windows.

## À mettre dans le CLAUDE.md d'un projet

```markdown
## Tickets

Les tickets de ce projet sont sur le tableau Todoom « <Nom du tableau> ».
Utilise les outils MCP todoom (ou la commande `todoom`, sortie JSON) ; n'écris
jamais les fichiers JSON du dossier Todoom à la main.

- Avant de commencer : `get_board` pour lire le contexte du tableau, et le suivre.
- Au début d'un ticket : `claim_card` avec `column` « En cours » et `conversation`
  (un nom court pour cette conversation). S'il est refusé parce qu'un autre
  l'a déjà pris, n'y touche pas et dis-le-moi.
- À la fin : `add_comment` avec le compte rendu (ce qui a été fait, comment le
  vérifier), `move_card` vers « A verifier », puis `release_card`.
```

« Pris par » est aussi un verrou : l'agent ne prend pas une carte « En cours »
prise par une conversation ou un autre PC. Drive met quelques secondes à porter
un changement d'un PC à l'autre : deux PC qui prennent la même carte dans cet
intervalle peuvent tous deux la croire à eux.
