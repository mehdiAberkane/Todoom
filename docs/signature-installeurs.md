# Signer les installeurs : étude

État au 2026-11-20. Les prix viennent des pages des fournisseurs et d'articles récents :
à revérifier avant de payer.

## Ce que la signature changerait

Les installeurs Todoom ne sont signés ni par un certificat Windows ni par Apple. Ce que
ça produit aujourd'hui :

| Cas | Windows | macOS |
|---|---|---|
| Première installation depuis le navigateur | SmartScreen : « Windows a protégé votre ordinateur », puis « Exécuter quand même » | Gatekeeper refuse l'app (« endommagée »), à débloquer une fois avec `xattr -cr /Applications/Todoom.app` |
| Mise à jour par le bouton de l'app | aucune alerte | aucune alerte |

Les mises à jour ne passent pas par le navigateur, donc n'ont pas la « marque du web »
qui déclenche SmartScreen et Gatekeeper, et elles sont déjà protégées par la signature
Tauri ([cle-de-signature.md](cle-de-signature.md)). **La signature système ne sert qu'à
la première installation sur chaque machine.**

## Options

### Windows

| Option | Coût | Limites |
|---|---|---|
| **Azure Artifact Signing** (ex-Trusted Signing) | ~9,99 $/mois (Basic, 5 000 signatures) | Particuliers : **USA et Canada uniquement** ; en Europe, réservé aux organisations. Abonnement Azure payant requis. |
| **Certificat OV** d'une autorité (Sectigo, DigiCert, SSL.com…) | ~150 à 300 $/an | Validité maximale ~15 mois ; clé sur jeton matériel ou HSM en ligne. Ne supprime **pas** SmartScreen d'emblée : la réputation se gagne avec les téléchargements. |
| **Certificat EV** | plus cher | Depuis mars 2024, plus d'avantage SmartScreen sur l'OV : sans intérêt ici. |
| **Certum « Open Source Code Signing »** | dizaines d'euros/an | Réservé aux projets open source ; prix et conditions à confirmer sur la boutique Certum. |
| **SignPath Foundation** | gratuit | Projets **open source** sous licence approuvée OSI, builds automatisés depuis GitHub, double authentification ; le certificat est au nom de la fondation, et les releases doivent la citer. |

### macOS

| Option | Coût | Limites |
|---|---|---|
| **Apple Developer Program** (Developer ID + notarisation) | 99 $/an | Compte Apple Developer ; signature et notarisation à ajouter au flux de publication (secrets supplémentaires dans GitHub). |

Aucune option gratuite côté Apple.

## Recommandation

Pour un usage personnel sur quelques machines : **ne pas payer de signature**. L'alerte ne
s'affiche qu'à la première installation de chaque poste, et les mises à jour en sont
exemptes.

À reconsidérer si Todoom est distribué à d'autres personnes :

1. si le code passe sous licence open source (voir `LICENSE`) : demander la signature
   Windows gratuite à SignPath Foundation ;
2. pour macOS : Apple Developer Program à 99 $/an, seule voie pour supprimer l'alerte ;
3. sinon, pour Windows : un certificat OV (~150 à 300 $/an).

## Sources

- [Options de signature pour les applications Windows (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
- [Azure Artifact Signing : coût et mise en route (G.D.G. Software)](https://www.gdgsoft.com/faq/azure-trusted-signing-cost-effective-exe-code-signing)
- [Prix des certificats de signature en 2026 (OneSigner)](https://onesign.sg/blog/industry-news/code-signing-certificate-prices-2026)
- [EV ou OV ? (SSL.com)](https://ssl.com/faqs/which-code-signing-certificate-do-i-need-ev-ov/)
- [Certum : Open Source Code Signing](https://shop.certum.eu/open-source-code-signing-code.html)
- [SignPath Foundation : conditions](https://signpath.org/terms)
- [Apple Developer Program : inscription et tarif](https://developer.apple.com/support/enrollment/)
