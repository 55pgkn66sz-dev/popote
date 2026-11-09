# Widget Grist « Consommations individuelles »

Suivi des consommations (café, repas…) **de personnes**, avec règlement par virement / Wero et back office pour le gestionnaire.
Le widget est repris du module « Consommations » de SERVIR, réduit aux seules consommations individuelles : plus de pelotons, de cadres ni d'effets commandés.

| Fichier | Rôle |
|---|---|
| `index.html`, `style.css`, `app.js` | Interface et accès à Grist (niveau d'accès demandé : **accès complet**) |
| `core.js` | Logique pure : soldes, IBAN, QR SEPA, schéma des tables. Testée sous Node |
| `test/core.test.js` | Tests unitaires (`node --test test/`) |
| `dev/mock-grist.js` | Faux Grist en mémoire, pour essayer l'interface : `index.html?demo=1` |

Il n'y a **aucune étape de build** : ce sont des fichiers statiques.

---

## 1. Installer le widget

1. Publiez le dossier sur un hébergement statique en HTTPS (GitHub Pages, par exemple). Seuls `index.html`, `style.css`, `app.js` et `core.js` sont nécessaires.
2. Dans Grist : **Ajouter un widget → Personnalisé → URL personnalisée**, collez l'adresse de `index.html`, puis choisissez **Accès complet au document** (nécessaire pour créer les tables).
3. Ouvrez l'onglet **Back office** du widget et suivez le § 2.

Deux pages Grist, un même widget :

| Page | URL du widget | Public | Onglets |
|---|---|---|---|
| Gestion | `…/index.html` | le gestionnaire | Suivi, Achats, Régler, Back office |
| Consommateurs | `…/index.html?vue=regler` | tout le monde | Régler uniquement (QR, IBAN, Wero, lien du formulaire) |

> **Le widget n'est pas un garde-fou.** Cacher un onglet n'empêche rien : seules les permissions avancées du § 4 protègent les données.

> Si le widget est lié à une table (par exemple `Conso_Consommations`), il se recharge à chaque modification de cette table. Sinon, utilisez « Actualiser ».

## 2. Back office, pas à pas

1. **Installation** : cliquez sur **Créer / compléter les tables**. L'opération est répétable sans danger : elle ne supprime et n'écrase rien. Elle crée les 6 tables du § 3, amorce 5 types (café, boisson, petit-déjeuner, repas midi, repas soir) et une ligne de configuration, puis règle l'affichage du **nom** dans les listes de choix.
2. **Règlement** : titulaire, IBAN (clé de contrôle vérifiée), numéro Wero. Ces valeurs sont stockées dans la table `Conso_Config`.
   - Le QR code est un **virement SEPA** (norme EPC) prérempli avec le montant dû, lisible par les applications bancaires.
   - Wero ne publie pas de format de QR ouvert : pour un QR Wero, collez dans « Contenu du QR » le contenu du code « Recevoir » de l'application Wero. Il remplace alors le virement SEPA.
3. **Formulaire externe et gestionnaire** : collez le lien du formulaire (§ 5) et le courriel du gestionnaire. Ce courriel doit être **identique au compte Grist, casse comprise** : les permissions du § 4 s'appuient dessus.
4. **Consommateurs** : ajout un à un ou en lot (une ligne `Nom Prénom ; courriel`). Désactivez plutôt que supprimer : l'historique est conservé et la personne disparaît de la liste du formulaire. Les noms doivent être uniques.
5. **Types et tarifs** : chaque type correspond à une colonne de `Conso_Consommations`. L'ajout d'un type crée la colonne. Un type ne se supprime pas, il s'**archive**.
   **Le tarif s'applique à tout l'historique.** Pour un changement de prix à une date donnée, archivez l'ancien type et créez-en un nouveau.

### Ajouter une consommation à la main

Onglet **Suivi → Ajouter une consommation** (ou le même bouton dans la fiche d'une personne, qui présélectionne celle-ci) : choisissez le consommateur, la date et les quantités. Le formulaire reste ouvert pour enchaîner plusieurs saisies. La ligne est créée dans `Conso_Consommations` avec le commentaire « Saisie manuelle ». Réservé au gestionnaire par les permissions du § 4 (création ouverte à tous sur cette table : voir § 4.5).

**Saisie en lot** : dans la même fenêtre, choisissez « En lot (plusieurs consommateurs) ». Tous les consommateurs actifs sont cochés par défaut (boutons « Tout cocher » / « Tout décocher ») ; les quantités saisies s'appliquent à **chaque** personne cochée, avec une ligne créée par personne (commentaire « Saisie manuelle (lot) »). Le résumé indique le montant par personne et le total avant l'enregistrement. Pratique pour une consommation commune (pot, repas partagé).

### Enregistrer un règlement

Onglet **Suivi → Enregistrer un règlement** : choisissez le consommateur (le solde dû est indiqué dans la liste et proposé comme montant), la date, le montant et des observations (virement, espèces, chèque n°…). La fenêtre reste ouverte pour enchaîner. La ligne est créée dans `Conso_Reglements` ; un montant supérieur au solde donne un avoir. Dans la fiche d'une personne, on peut aussi enregistrer un règlement et supprimer un règlement saisi par erreur (suppression en deux clics). Écriture réservée au gestionnaire (§ 4.5).

**Règlements en lot** : choisissez « En lot (plusieurs consommateurs) ». La liste reprend les personnes qui doivent encore de l'argent, toutes cochées, avec le solde dû comme montant reçu. Modifiez un montant pour un paiement partiel, décochez ceux qui n'ont pas payé, puis enregistrez : la date et les observations sont communes, et un règlement est créé par personne cochée, en une seule opération (tout est enregistré ou rien). Un montant invalide bloque l'enregistrement et nomme la personne concernée. Après enregistrement, la liste ne garde que les soldes restants.

### Modifier une ligne

Chaque achat (onglet **Achats**), chaque règlement et chaque consommation (dans la fiche d'une personne) a un bouton **Modifier** à côté de **Supprimer**. La fenêtre reprend les valeurs actuelles : date, montant, observations, et pour une consommation le consommateur et les quantités de tous les types (y compris archivés). Les mêmes contrôles que pour la saisie s'appliquent, et l'on peut changer le consommateur d'un règlement ou d'une consommation saisi(e) pour la mauvaise personne. Après enregistrement, la fiche de la personne s'affiche à nouveau. La modification exige le droit de modification de la table (gestionnaire, § 4).

### Enregistrer les achats

Onglet **Achats** : enregistrez ce que le gestionnaire achète pour la popote (café, lait, denrées…) : date, achat, fournisseur (facultatif), montant, observations. La date et le fournisseur restent préremplis pour enchaîner plusieurs achats. La liste peut être exportée en CSV, et un achat saisi par erreur se supprime en deux clics.
Les indicateurs affichent le total des achats, le total encaissé (règlements) et le **solde popote** (encaissé − achats ; en rouge s'il est négatif). Les achats n'entrent **pas** dans le solde des consommateurs.

## 3. Schéma des tables

Toutes les colonnes sont créées par le bouton. Les identifiants sont fixes (le widget les lit par leur nom).

**Tables de référence** (écriture réservée au gestionnaire, § 4)

`Conso_Config` : une seule ligne.

| Colonne | Type | Contenu |
|---|---|---|
| `Titulaire` | Texte | Titulaire du compte |
| `IBAN` | Texte | IBAN du gestionnaire |
| `Numero_Wero` | Texte | Numéro Wero |
| `QR_Contenu` | Texte | QR personnalisé (facultatif) |
| `Lien_formulaire` | Texte | Lien du formulaire Grist |
| `Email_gestionnaire` | Texte | Courriel du gestionnaire (permissions) |

`Conso_Consommateurs`

| Colonne | Type | Contenu |
|---|---|---|
| `Nom` | Texte | Nom affiché dans le formulaire |
| `Email` | Texte | Courriel (facultatif) |
| `Actif` | Booléen | Proposé dans le formulaire |

`Conso_Types`

| Colonne | Type | Contenu |
|---|---|---|
| `Libelle` | Texte | Nom du type (par exemple « Café ») |
| `Colonne` | Texte | Identifiant de la colonne dans `Conso_Consommations` (fixé à la création, ne change plus) |
| `Tarif` | Numérique | Prix unitaire en euros |
| `Actif` | Booléen | Type en cours (sinon archivé) |

**Tables de saisie**

`Conso_Consommations` (alimentée par le formulaire)

| Colonne | Type | Contenu |
|---|---|---|
| `Date` | Date | Remplie à la création de la ligne (formule de déclenchement `TODAY()`) |
| `Consommateur` | Référence → `Conso_Consommateurs` | Affiche `Nom` ; liste limitée par la condition `choice.Actif` |
| `Commentaire` | Texte | Libre |
| *une colonne par type* | Numérique | Quantité consommée |

`Conso_Reglements` (saisie par le gestionnaire)

| Colonne | Type | Contenu |
|---|---|---|
| `Date` | Date | Date du règlement |
| `Consommateur` | Référence → `Conso_Consommateurs` | Qui a payé |
| `Montant` | Numérique | Euros |
| `Observations` | Texte | Virement, espèces… |

`Conso_Achats` (saisie par le gestionnaire)

| Colonne | Type | Contenu |
|---|---|---|
| `Date` | Date | Date de l'achat |
| `Libelle` | Texte | Ce qui a été acheté |
| `Fournisseur` | Texte | Facultatif |
| `Montant` | Numérique | Euros |
| `Observations` | Texte | Facture n°, remboursé… |

Calcul : **dû** = Σ (quantité × tarif du type), **solde** = dû − réglé. Les calculs sont faits en centimes. Un solde négatif s'affiche comme un avoir.

---

## 4. Permissions avancées : seul le gestionnaire modifie les tables de référence

> **Avant de commencer.** Travaillez sur une **copie** du document. Gardez toujours une règle propriétaire (`user.Access == OWNER`) en tête de chaque table : elle évite de vous enfermer dehors. Un propriétaire du document garde de toute façon la main sur les règles.

Principe : l'identité du gestionnaire est lue dans `Conso_Config.Email_gestionnaire`, comparée au courriel du compte connecté.

### 4.1 Ouvrir les règles d'accès

Dans Grist, ouvrez le menu du document (icône en haut à gauche, ou « Partager »), puis **Gérer les utilisateurs** et **Permissions avancées** (ou **Règles d'accès**, selon la version).
Cochez **Permissions avancées** si ce n'est pas déjà fait.

### 4.2 Règles spéciales

Décochez **Autoriser les éditeurs à modifier la structure** (colonnes, types, noms). Seuls les propriétaires pourront alors changer le schéma.

### 4.3 Attribut utilisateur

Dans **Attributs utilisateur**, ajoutez :

| Champ | Valeur |
|---|---|
| Nom | `Gestionnaire` |
| Attribut à rechercher | `user.Email` |
| Table de recherche | `Conso_Config` |
| Colonne de recherche | `Email_gestionnaire` |

`user.Gestionnaire.id` vaut un numéro de ligne si le courriel de la personne connectée est celui du gestionnaire, et 0 sinon.

### 4.4 Règles des 3 tables de référence

Ajoutez une ressource pour chacune des tables `Conso_Config`, `Conso_Consommateurs` et `Conso_Types` (colonnes : **Toutes**). Pour chaque ressource, créez ces règles **dans cet ordre** (la première règle applicable l'emporte) :

| # | Condition | Lecture | Modification | Création | Suppression |
|---|---|---|---|---|---|
| 1 | `user.Access == OWNER or user.Gestionnaire.id` | ✔ | ✔ | ✔ | ✔ |
| 2 | *(vide : tout le monde)* | ✔ | ✘ | ✘ | ✘ |

La lecture reste ouverte à tous : le formulaire a besoin des noms, et chacun doit pouvoir lire l'IBAN pour payer.

### 4.5 Règles des tables de saisie

`Conso_Consommations`

| # | Condition | Lecture | Modification | Création | Suppression |
|---|---|---|---|---|---|
| 1 | `user.Access == OWNER or user.Gestionnaire.id` | ✔ | ✔ | ✔ | ✔ |
| 2 | *(vide)* | ✘ | ✘ | **✔** | ✘ |

La création reste ouverte à tous pour que le **formulaire public** fonctionne. Si les consommateurs doivent pouvoir relire leurs propres lignes, remplacez la lecture de la règle 2 par la condition `user.Email == rec.Consommateur.Email` (lecture ✔).

`Conso_Reglements`

| # | Condition | Lecture | Modification | Création | Suppression |
|---|---|---|---|---|---|
| 1 | `user.Access == OWNER or user.Gestionnaire.id` | ✔ | ✔ | ✔ | ✔ |
| 2 | *(vide)* | ✘ | ✘ | ✘ | ✘ |

`Conso_Achats` : mêmes règles que `Conso_Reglements` (gestionnaire seul en lecture, modification, création et suppression ; règle 2 : tout refusé).

Facultatif : pour masquer les courriels des consommateurs, ajoutez sur `Conso_Consommateurs`, **colonne `Email`**, en tête : condition `user.Access == OWNER or user.Gestionnaire.id` → lecture ✔ ; puis tout le monde → lecture ✘.

### 4.6 Vérifier avec « Voir en tant que »

Dans la fenêtre des règles, utilisez **Voir en tant que** (utilisateur de test, ou courriel de votre choix), puis contrôlez :

- [ ] Le gestionnaire (courriel de `Email_gestionnaire`) modifie `Conso_Config`, `Conso_Consommateurs`, `Conso_Types`.
- [ ] Un autre utilisateur « éditeur » obtient un refus en modifiant, ajoutant ou supprimant une ligne de ces 3 tables. Dans le widget, un message « Droits insuffisants » s'affiche.
- [ ] Le même utilisateur peut toujours **lire** `Conso_Config` : la page `?vue=regler` affiche le QR et l'IBAN.
- [ ] Le même utilisateur ne peut ni modifier ni supprimer une consommation, et ne peut rien écrire dans `Conso_Reglements` ni `Conso_Achats`.
- [ ] **Navigation privée, sans compte** : l'envoi du formulaire (§ 5) fonctionne toujours et la ligne arrive dans `Conso_Consommations`.
- [ ] Courriel du gestionnaire **vide ou erroné** : seuls les propriétaires modifient (comportement voulu, sans blocage).

### 4.7 Pièges

- **Casse du courriel** : `Prenom.Nom@…` et `prenom.nom@…` ne sont pas égaux pour la règle.
- **Plusieurs gestionnaires** : la recherche se fait sur une seule ligne. Utilisez alors un propriétaire (`OWNER`) par gestionnaire supplémentaire, ou remplacez `Conso_Config` par une table de gestionnaires (une ligne par courriel).
- Les règles protègent les **données**, pas l'affichage : un utilisateur sans droit voit les onglets du widget, mais ses écritures sont refusées.

---

## 5. Créer le formulaire externe (Grist Forms)

Le formulaire permet de déclarer ses consommations sans ouvrir le document.

1. Ouvrez une page Grist, **Ajouter une page → Sélectionner un widget → Formulaire**, et choisissez la table `Conso_Consommations`. Les formulaires demandent une version de Grist récente (1.7 ou plus) : sinon, mettez le document à jour ou passez par l'administrateur.
2. Placez les champs :
   - **Consommateur** : liste déroulante, **obligatoire**. Vérifiez dans les options de la colonne que la condition de liste est bien `choice.Actif` et que la colonne affichée est `Nom` ; le bouton de création les règle, mais contrôlez-le.
   - **un champ numérique par type** (Café, Repas midi…), non obligatoires : un champ laissé vide compte pour 0.
   - **Commentaire** : facultatif.
   - Ne mettez pas `Date` : elle est renseignée à la création. Vérifiez-le à l'essai (§ 5.5).
3. Réglez le titre et les consignes (par exemple « Qu'avez-vous consommé ? »), et le message de confirmation.
4. **Publier** : bouton **Publier**, puis **Partager** (lien public). Seul un propriétaire du document peut publier. Copiez le lien.
5. Dans le widget, **Back office → Formulaire externe**, collez le lien et **Enregistrer**. Le bouton « Déclarer une consommation » et le **QR code du formulaire** apparaissent alors dans les vues Suivi et Régler.
6. **Essai** : depuis une fenêtre de navigation privée, envoyez une consommation. Elle doit apparaître dans `Conso_Consommations`, avec la date du jour, et dans le widget.

Le formulaire public ne vérifie pas l'identité de la personne : il fait confiance au choix dans la liste (cas limites ci-dessous).

**Ajouter un type** : dans le Back office, ajoutez le type, puis dans l'éditeur du formulaire ajoutez le nouveau champ et republiez.
**Archiver un type** : décochez « Actif » dans le Back office, retirez son champ du formulaire et republiez.

---

## 6. Cas limites à connaître

| Cas | Comportement |
|---|---|
| Deux personnes de même nom | Refusé : les noms doivent être uniques (ajoutez un repère). |
| Un consommateur désactivé a des consommations | Il reste visible dans le Suivi avec son solde. |
| Ligne de consommation sans consommateur, ou consommateur supprimé | Non comptée ; un bandeau signale le nombre de lignes et le montant. |
| Suppression d'un consommateur qui a un historique | Refusée : désactivez-le. |
| Changement de tarif | Rétroactif : archivez le type et créez-en un autre. |
| Quantités négatives ou texte dans une colonne de type | Négatif : pris tel quel (permet de corriger) ; texte : compté 0. |
| Plusieurs lignes dans `Conso_Config` | Seule la première est lue ; un avertissement s'affiche. |
| IBAN invalide | Enregistrement refusé ; QR indisponible. |
| Lien du formulaire non http(s) | Refusé ; seuls `http://` et `https://` sont acceptés. |
| Usurpation | Le formulaire est public : n'importe qui peut déclarer pour quelqu'un d'autre. Le gestionnaire contrôle les lignes et peut les supprimer. |
| Bibliothèque de QR code bloquée (réseau) | Les coordonnées (IBAN, Wero) restent affichées en texte. |

## 7. Tests

**Automatiques** : `node --test test/` (11 tests : soldes en centimes, achats, IBAN, QR SEPA, schéma, CSV, dates).

**À faire dans un vrai document Grist** (le faux Grist de `dev/` ne remplace pas Grist) :

1. Sur une copie vide : **Créer / compléter les tables**, puis cliquer une 2e fois (rien ne doit changer).
2. Dans la table `Conso_Consommations`, la colonne **Consommateur** affiche des noms (pas des numéros), et la condition de liste est `choice.Actif`.
3. Ajouter un type : la colonne apparaît dans `Conso_Consommations`.
4. Renommer un type : le libellé de la colonne suit.
5. Envoi du formulaire en navigation privée : la ligne est créée, avec la date.
6. Permissions : toutes les vérifications du § 4.6.
7. Régler : le QR est lu par une application bancaire (montant prérempli) ; l'IBAN affiché correspond.
8. Export CSV : ouverture dans Excel (accents, `;`). Si le téléchargement est bloqué par le cadre du widget, signalez-le.
9. Plusieurs centaines de lignes de consommations : temps de chargement acceptable.
