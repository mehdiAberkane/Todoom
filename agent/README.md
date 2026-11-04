# Agent Todoom

Surveille un tableau Todoom toutes les 30 secondes. Chaque ticket placé dans « En cours » est confié à Claude Code en mode non interactif, un ticket à la fois :

1. le ticket passe dans la colonne « Agent » (créée automatiquement) ;
2. Claude travaille sur une branche `agent/<ticket>` du dépôt associé, lance les vérifications prévues, puis commite ;
3. le ticket passe dans « À valider », avec la branche, les commits et le résumé de Claude dans sa description.

L'agent ne pousse jamais et ne fusionne jamais. Relisez la branche, puis fusionnez-la vous-même. Si le dépôt a des modifications non commitées, le ticket attend.

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
| `base_branch` | branche de départ de chaque ticket |
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
