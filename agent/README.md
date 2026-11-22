# Agent Todoom

Surveille un ou plusieurs tableaux Todoom toutes les 30 secondes. Chaque ticket placé dans « En cours » est confié à Claude Code en mode non interactif, un ticket à la fois :

1. le ticket passe dans la colonne « Agent » (créée automatiquement) ;
2. l'agent se place sur la branche de base, récupère ce qui a été fusionné, puis crée une branche pour le ticket ;
3. Claude y fait le travail, lance les vérifications prévues, puis commite ;
4. l'agent pousse la branche et ouvre une merge request (GitLab) ou une pull request (GitHub) vers la branche de base ;
5. le ticket passe dans « A verifier », avec un commentaire signé de l'agent : la branche, les commits, le lien de la merge request et le résumé de Claude. Ses déplacements sont inscrits dans l'historique de la carte, et la branche et la merge request remplissent les champs de la carte. Quand la branche arrive dans la branche de base, la merge request passe en « fusionnée » ;
6. en cas d'échec, il passe dans « Echec » avec le même compte rendu. C'est le cas si Claude renvoie une erreur ou dépasse le temps maximal, s'il ne produit aucun commit, s'il laisse des modifications non commitées, ou si une commande git ou le push échoue. Rien n'est poussé si le travail de Claude a échoué.

Une carte « En cours » déjà prise par quelqu'un d'autre (une conversation Claude, un autre PC : champ « Pris par ») est laissée de côté. L'agent prend le ticket quand il commence et le libère quand il a fini.

Dans Todoom, l'en-tête du tableau montre l'état de l'agent : « 🤖 en attente », « 🤖 travaille sur TOD-12 », « 🤖 arrêté », ou « muet, arrêté ? » quand il n'a plus donné signe de vie depuis plus de trois minutes (fichier `boards/<id>/agents/<PC>-agent.json`).

Vous faites ensuite la revue et la fusion sur GitLab ou GitHub, puis vous passez le ticket en « Terminé ». L'agent ne fusionne jamais, et la commande `git push` est interdite à Claude ; ce n'est pas une barrière de sécurité, voir [Sécurité](#sécurité).

Pour réessayer un ticket en échec, remettez-le dans « En cours » : l'agent reprend sur la même branche. Si le dépôt a des modifications non commitées, le ticket attend.

## Noms de branches

Claude choisit le nom au format `<type>/<mots-avec-tirets>`, par exemple `feature/module-scope` :

| Type | Usage |
|---|---|
| `feature` | nouvelle fonctionnalité |
| `hotfix`, `bugfix` | correction |
| `security` | problème de sécurité |
| `quality` | qualité du code |

Si le nom proposé n'est pas valide, l'agent le déduit du titre du ticket. Si la branche existe déjà pour un autre ticket, il ajoute un suffixe.

La merge request passe par les options de push de GitLab : aucun token n'est nécessaire, seul l'accès SSH au dépôt compte. La branche source est supprimée sur GitLab à la fusion.

## Sécurité

**L'agent exécute du code choisi par le texte d'un ticket.** Claude reçoit le contexte du tableau (« 📖 Contexte » dans Todoom), le titre, la description et les commentaires, peut modifier les fichiers du dépôt et lancer les commandes de `tools` (`go *` par défaut). Or `go run`, `go test`, `npm test` ou `npm run` exécutent n'importe quel programme ou script du dépôt. Interdire `git push` ou `git checkout` à Claude n'empêche rien : un tel programme peut pousser, lire ou effacer ce qu'il veut.

À qui l'agent fait confiance, donc :

- **toute personne ou tout programme qui peut écrire dans le dossier Todoom sur Drive** : créer ou modifier un ticket dans « En cours » suffit ;
- **tout texte qui finit dans un ticket** : copier un message d'erreur, une issue ou une page web dans une description ou un commentaire, c'est le donner en instruction à Claude.

Sans isolation, ce code tourne **avec tes droits** : tes fichiers, ton navigateur, tes clés SSH (`~/.ssh`) et ce qu'elles ouvrent, tes autres dépôts. L'agent retire déjà de l'environnement de Claude les variables qui ressemblent à des secrets (jetons, mots de passe, agent SSH), mais pas les fichiers que ton compte peut lire. Au démarrage, `agent.log` le rappelle tant qu'aucune isolation n'est configurée.

### Réduire le risque

Du plus simple au plus solide :

1. **Un clone dédié du dépôt** pour `repo`, jamais ta copie de travail : un ticket raté ou piégé n'abîme pas ton travail en cours.
2. **Un jeton de push limité à la place de ta clé SSH personnelle.** Sur GitLab, créer un *Project Access Token* (rôle Developer, portée `write_repository`) sur ce seul projet, protéger la branche de base (personne ne pousse dessus, fusion par merge request uniquement), puis ajouter un remote dédié dans le clone et le mettre dans `remote` :
   ```powershell
   git -C <clone> remote add agent https://oauth2:<jeton>@gitlab.com/<groupe>/<projet>.git
   ```
   Le pire possible devient « des branches poussées sur ce projet », au lieu de « tout ce que ta clé SSH ouvre ».
3. **Faire tourner Claude ailleurs que sous ton compte**, avec le réglage `sandbox` : une commande placée devant `claude`, où `{repo}` est remplacé par le chemin du dépôt. Par exemple un conteneur qui ne voit que le clone :
   ```json
   "sandbox": ["docker", "run", "--rm", "-v", "{repo}:/work", "-w", "/work", "-e", "ANTHROPIC_API_KEY", "todoom-agent"]
   ```
   où `todoom-agent` est une image contenant Go et Claude Code. Cet exemple est à adapter, il n'a pas été testé tel quel. Un compte Windows dédié est l'autre option, mais il ne voit pas ton Google Drive : seul l'appel à Claude doit y tourner, pas l'agent qui lit le tableau.

   Le conteneur voit aussi `.git` : un hook ou une ligne de `.git/config` (`core.fsmonitor`, `core.sshCommand`…) écrits depuis le bac à sable s'exécuteraient sur ton ordinateur au git suivant de l'agent. Avec `sandbox`, l'agent relit donc `.git/config`, `.git/hooks` et `.git/info` après Claude, sans lancer git : s'ils ont changé, il ne pousse rien, l'écrit sur la carte et s'arrête, le temps que tu vérifies.

Quoi qu'il arrive, l'agent ne suit que des identifiants de carte de la forme de ceux de Todoom, égaux au nom de leur fichier (un `../` mènerait hors du dossier), et ne reprend une branche citée dans un commentaire (« Branche : … ») que si elle a la forme des siennes (`feature/…`, `bugfix/…`) : jamais `develop`, une branche de release ou la branche de base. Sous Windows, l'agent SSH et le gestionnaire d'identifiants git restent joignables sans variable d'environnement : seul `sandbox` ou un jeton limité (point 2) les met hors de portée.

### Relire la merge request comme du code tiers

Ce que l'agent pousse a été écrit sous la dictée d'un texte que tu n'as peut-être pas écrit toi-même. Relis toute la merge request avant de fusionner, et méfie-toi des changements hors du sujet du ticket : CI, scripts de build, dépendances, fichiers de configuration.

## Installation

Installer la CLI Claude Code, puis se connecter une fois en lançant `claude` :

```powershell
irm https://claude.ai/install.ps1 | iex
```

Copier `config.example.json` en `config.json` et le remplir :

| Clé | Rôle |
|---|---|
| `board_dir` | dossier du tableau dans les données Todoom (`boards/<id>`) |
| `repo` | dépôt git où l'agent travaille |
| `project` | nom et description courte du projet, donnés à Claude |
| `checks` | vérifications à lancer avant de commiter |
| `tools` | commandes que Claude peut lancer en plus de git, au format de Claude Code : `["go *", "gofmt *"]` par défaut, `["npm *", "npx *"]` pour un projet npm. Les commandes git sont gérées par l'agent et refusées ici |
| `forge` | `gitlab`, `github`, ou `auto` (par défaut : GitHub si l'adresse du dépôt distant contient github.com). Sur GitHub, la pull request est ouverte avec la commande `gh`, si elle est installée et connectée |
| `base_branch` | branche de départ de chaque ticket et cible des merge requests |
| `remote` | dépôt distant où pousser (`origin` par défaut) |
| `poll_seconds`, `ticket_timeout_minutes` | rythme de surveillance et durée maximale d'un ticket |
| `sandbox` | commande qui fait tourner Claude isolé, par exemple dans un conteneur (vide par défaut, voir [Sécurité](#sécurité)) |

Plusieurs tableaux : mettre leurs réglages dans une liste `boards`. Chaque tableau prend ses propres clés, sinon celles du haut du fichier, sinon les valeurs par défaut. `poll_seconds`, `ticket_timeout_minutes` et `sandbox` valent pour tous. L'ancien format, un seul tableau en haut du fichier, marche toujours.

```json
{
  "poll_seconds": 30,
  "boards": [
    { "board_dir": "G:\\Mon Drive\\Todoom\\boards\\<id-solaris>", "repo": "C:\\projets\\solaris",
      "checks": "go vet ./... et go test ./..." },
    { "board_dir": "G:\\Mon Drive\\Todoom\\boards\\<id-luna>", "repo": "C:\\projets\\luna",
      "tools": ["npm *", "npx *"], "checks": "npm run lint et npm test", "forge": "github" }
  ]
}
```

`config.json` contient vos chemins et l'ID de votre tableau : il est ignoré par git.

## Lancement

Test sans rien modifier (affiche les tickets qui seraient pris) :

```powershell
python agent\todoom_agent.py --dry-run
```

Un seul passage, puis arrêt :

```powershell
python agent\todoom_agent.py --once
```

En continu au démarrage de la session Windows, sans fenêtre (adaptez les deux chemins) :

```powershell
schtasks /Create /TN "Todoom Agent" /SC ONLOGON /RL LIMITED /TR "\"<chemin>\pythonw.exe\" \"<chemin>\Todoom\agent\todoom_agent.py\""
```

Pour l'arrêter : `schtasks /End /TN "Todoom Agent"`, et pour le retirer : `schtasks /Delete /TN "Todoom Agent" /F`.

Le journal est dans `agent\agent.log`. Les outils toujours permis (lecture, écriture, `git status/diff/log/add/commit`) sont en haut de `todoom_agent.py` ; le reste vient de `tools`.

Ne lancez l'agent que sur un seul PC à la fois, sinon deux machines peuvent prendre le même ticket.
