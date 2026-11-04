# Agent Todoom

Surveille un tableau Todoom toutes les 30 secondes. Chaque ticket placé dans « En cours » est confié à Claude Code en mode non interactif, un ticket à la fois :

1. le ticket passe dans la colonne « Agent » (créée automatiquement) ;
2. l'agent se place sur la branche de base, récupère les merge requests fusionnées sur GitLab, puis crée une branche pour le ticket ;
3. Claude y fait le travail, lance les vérifications prévues, puis commite ;
4. l'agent pousse la branche sur GitLab et ouvre une merge request vers la branche de base ;
5. le ticket passe dans « A verifier », avec la branche, les commits, le lien de la merge request et le résumé de Claude dans sa description ;
6. en cas d'échec, il passe dans « Echec » avec le même compte rendu. C'est le cas si Claude renvoie une erreur ou dépasse le temps maximal, s'il ne produit aucun commit, s'il laisse des modifications non commitées, ou si une commande git ou le push échoue. Rien n'est poussé si le travail de Claude a échoué.

Vous faites ensuite la revue et la fusion sur GitLab, puis vous passez le ticket en « Terminé ». L'agent ne fusionne jamais, et Claude lui-même n'a pas le droit de pousser.

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
| `base_branch` | branche de départ de chaque ticket et cible des merge requests |
| `remote` | dépôt distant où pousser (`origin` par défaut) |
| `poll_seconds`, `ticket_timeout_minutes` | rythme de surveillance et durée maximale d'un ticket |

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

Le journal est dans `agent\agent.log`. Les outils que Claude a le droit d'utiliser sont en haut de `todoom_agent.py`.

Ne lancez l'agent que sur un seul PC à la fois, sinon deux machines peuvent prendre le même ticket.
