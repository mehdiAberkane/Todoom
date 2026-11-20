# Politique de sécurité

## Signaler une faille

Merci de **ne pas ouvrir d'issue publique** pour une faille de sécurité.

Utilise le signalement privé de GitHub : onglet **Security** du dépôt →
**Report a vulnerability**. Le rapport n'est visible que par le mainteneur.

Indique si possible :

- la version de Todoom (barre de titre, ou Paramètres → À propos) et le système ;
- ce qu'un attaquant peut faire, et ce dont il a besoin au départ (accès au dossier
  de données, à un ticket, au réseau…) ;
- les étapes pour reproduire.

Todoom est un projet personnel maintenu sur le temps libre : pas de délai garanti,
mais chaque signalement est lu et reçoit une réponse.

## Versions suivies

Seule la dernière version publiée reçoit des correctifs. Les installations se mettent
à jour depuis l'application (bouton « Mettre à jour »).

## Points sensibles connus

- **Mises à jour** : chaque mise à jour est signée ; une installation n'accepte que
  les mises à jour signées par la clé du projet ([docs/cle-de-signature.md](docs/cle-de-signature.md)).
- **Dossier de données** : quiconque peut écrire dans le dossier Todoom (par exemple
  le dossier Google Drive partagé) peut modifier les tableaux. Les fichiers au format
  inattendu sont signalés et ne sont jamais écrasés ([schema/](schema/)).
- **Agent** : l'agent fait exécuter du code choisi par le texte des tickets ; voir la
  section Sécurité de [agent/README.md](agent/README.md) avant de l'utiliser.
- **Installeurs non signés** : la première installation déclenche une alerte de
  Windows ou de macOS ; voir [docs/signature-installeurs.md](docs/signature-installeurs.md).
