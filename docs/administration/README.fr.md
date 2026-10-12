# Administrer Ronde

Ce guide s'adresse aux personnes qui font fonctionner Ronde pour une organisation : l'administrateur d'une
instance auto-hébergée, et les propriétaires et administrateurs d'un espace de travail (dans le cloud ou
sur votre propre serveur). Pour installer Ronde, commencez par le
[guide d'auto-hébergement](../self-hosting/README.fr.md).

## L'instance

Le premier compte créé sur une nouvelle instance en devient l'**administrateur**. Il ouvre
**Administration du serveur** depuis le menu de l'espace, en haut à gauche (`/admin`), où il peut :

- voir combien de comptes, d'espaces de travail et de réunions contient l'instance ;
- choisir la langue par défaut, utilisée quand ni la personne ni son navigateur ne demandent une langue que
  Ronde parle ;
- décider qui peut créer un compte ;
- saisir ou retirer la clé de licence.

Les valeurs enregistrées sur cette page priment sur les variables d'environnement. Les réglages propres à chaque
espace (membres, rôles, sécurité) restent dans ses **Réglages**.

Dans le cloud, l'équipe de Ronde gère le serveur : il n'y a pas d'Administration du serveur, tout le
monde peut créer un compte, et l'offre de chaque espace vient de son abonnement.

### Qui peut créer un compte

| Règle | Qui peut s'inscrire |
| --- | --- |
| Sur invitation (par défaut) | Seulement les personnes invitées dans un espace de travail |
| Domaines e-mail | Les personnes invitées, et toute personne ayant une adresse des domaines listés |
| Ouverte | Toute personne qui accède à l'instance |

Le même choix peut se faire avec `SIGNUP_POLICY` (`invite-only`, `domains`, `open`) et
`SIGNUP_ALLOWED_DOMAINS`.

### Clé de licence

Les fonctions Team et Enterprise s'activent avec une clé de licence, saisie dans Administration du
serveur ou fournie par la variable `RONDE_LICENSE` (la variable l'emporte et verrouille le champ). La clé
est vérifiée sur le serveur, hors ligne : rien n'est envoyé nulle part. La page affiche l'offre, le client,
la date d'expiration et le nombre de places utilisées.

- **Plus de personnes que de places** : rien n'est bloqué ; la page vous invite à mettre la licence à jour.
- **Expirée** : une période de grâce de 14 jours garde tout en fonctionnement. Ensuite, les fonctions
  payantes passent en lecture seule : ce qu'elles contiennent reste lisible, rien de nouveau ne peut être
  ajouté. Les fonctions Community ne sont jamais touchées.
- L'image `ronde-ce` est construite à partir du seul code open source et ne sait pas lire une clé de
  licence : utilisez l'image `ronde` pour Team ou Enterprise.

Les écoles et les universités reçoivent une licence Enterprise gratuite : écrivez à hello@joinronde.com
depuis l'adresse de votre établissement.

### Masquer les offres payantes

Les administrateurs voient dans les réglages de discrètes mentions des fonctions payantes (jamais pendant
une réunion). Renseignez `RONDE_HIDE_UPGRADE_HINTS=1` pour les retirer de toute l'instance.

### Retours des utilisateurs

Le bouton en forme de bulle en haut des pages (dans le menu du compte sur téléphone) permet de signaler un problème
ou de proposer une idée, avec une capture d'écran si on le souhaite. Partent avec le message : l'adresse de la page
(sans ses paramètres), le navigateur, la taille de la fenêtre, la langue et la version de Ronde. Les administrateurs
lisent les messages dans **Administration du serveur**, répondent par e-mail aux personnes qui l'ont demandé, et
peuvent ouvrir un ticket prérempli sur le projet Ronde pour un problème propre à Ronde. Si `SENTRY_DSN` est
renseigné, les messages arrivent aussi dans ce projet Sentry comme retours d'utilisateurs. Les messages sont
supprimés au bout d'un an ; `RONDE_FEEDBACK=off` retire le bouton.

## Espaces de travail

Un espace de travail réunit les personnes, les réunions, les modèles et les connecteurs d'une équipe.
Toute personne autorisée à s'inscrire peut en créer un ; une personne peut appartenir à plusieurs. Ses
réglages se trouvent sous **Réglages** dans la barre latérale :

| Onglet | Ce qu'il contient | Qui le voit |
| --- | --- | --- |
| Général | Nom, lien, langue, catégories de métier, qui peut créer des réunions, connecteurs et intégrations | Tout le monde ; propriétaires et administrateurs le modifient |
| Sécurité | Domaines vérifiés, fournisseurs d'identité, LDAP, SCIM | Propriétaires et administrateurs (Enterprise) |
| Rôles | Rôles personnalisés | Propriétaires et administrateurs (Enterprise) |
| Journal d'audit | Qui a modifié quoi | Propriétaires et administrateurs (Team, Enterprise) |
| Facturation | Offre et factures | Propriétaires et rôle Facturation, dans le cloud |
| Offres | Ce qu'ajoutent Team et Enterprise, et où les obtenir | Propriétaires et administrateurs, en auto-hébergement |

### Rôles

Chaque membre a un rôle dans l'espace de travail :

| Rôle | Peut |
| --- | --- |
| Propriétaire | Tout, y compris la facturation et la suppression de l'espace |
| Administrateur | Tout sauf la facturation et la suppression ; agit comme régisseur de chaque réunion |
| Facturation | L'abonnement, les factures et le moyen de paiement, rien d'autre (dans le cloud) |
| Organisateur | Ce que peut un membre, plus créer des réunions quand elles sont réservées aux administrateurs, et inviter des personnes |
| Membre | Voir l'annuaire, créer des réunions (sauf si elles sont réservées aux organisateurs et administrateurs), enregistrer des modèles |
| Invité | Seulement les réunions où il est invité |

Chaque personne d'une réunion a aussi un rôle dans cette réunion :

| Rôle | Peut |
| --- | --- |
| Régisseur | Animer les séances, configurer la réunion, gérer ses personnes, modifier le compte rendu |
| Co-régisseur | Animer les séances et modifier le compte rendu, sans toucher aux réglages ni aux personnes de la réunion |
| Participant | Remplir sa fiche, participer aux séances, lire l'historique |
| Observateur | Suivre les séances et lire l'historique |

La personne qui crée une réunion en est le régisseur. Avec Enterprise, les **rôles personnalisés** ajoutent
des permissions aux membres et aux invités ; leurs permissions de réunion s'appliquent à toutes les réunions
de l'espace de travail.

### Personnes et invitations

L'**annuaire** est partagé par toutes les réunions de l'espace de travail : le nom d'une personne, son
anniversaire (jour et mois seulement), sa catégorie de métier et ses comptes GitLab ou GitHub se saisissent
une seule fois. On peut ajouter des personnes sans compte, pour une réunion où elles ne se connectent pas ;
les inviter envoie un e-mail avec un lien valable 14 jours. Retirer un membre met fin à son accès ; ses
fiches et son historique restent dans l'espace de travail. Avec SCIM, les personnes désactivées dans votre
annuaire perdent leur accès de la même façon.

### Absences

Chaque personne peut ajouter ses absences sur son profil (les gestionnaires de personnes peuvent le faire
pour n'importe qui) : un premier et un dernier jour, une note, et qui anime pendant ce temps les réunions
dont elle est régisseur. Pendant une absence, la personne est notée absente des séances de ces jours-là, ne
reçoit pas de rappels, et son profil indique quand elle revient. La personne désignée comme remplaçante
reçoit une notification et anime ces réunions comme régisseur, pour ces jours-là seulement.

### Marge entre les réunions

Dans l'onglet Général, **Marge entre deux réunions** (aucune, 5, 10, 15 ou 30 minutes) est laissée libre
avant et après chaque réunion d'une personne. « Trouver un créneau » la respecte, et la planification d'une
réunion signale les dates qui tombent trop près d'une autre réunion des mêmes personnes.

## Connexion et authentification unique

L'édition Community propose les comptes avec e-mail et mot de passe, les liens de connexion par e-mail, la
double authentification, les comptes Google, GitHub et Microsoft, et un fournisseur OpenID Connect pour
l'instance (variables `OIDC_*`, voir le [guide d'auto-hébergement](../self-hosting/README.fr.md)).

Chaque personne gère sa façon de se connecter depuis son compte, onglet **Connexion et sécurité** : mot de passe, clés d'accès (Face ID, Windows Hello, un gestionnaire de mots de passe ou une clé de sécurité), validation en deux étapes et déconnexion partout. Les clés d'accès sont liées au domaine d'`APP_URL`, qui doit être en HTTPS : après un changement de domaine, chacun les ajoute de nouveau. Une adresse soumise à l'authentification unique ne peut ni ajouter ni utiliser de clé d'accès.

Avec Enterprise, l'onglet **Sécurité** d'un espace de travail ajoute :

1. **Les domaines vérifiés.** Ajoutez votre domaine e-mail et l'enregistrement DNS affiché, puis vérifiez-le.
   Un domaine vérifié peut :
   - **capter les nouveaux comptes** : toute personne qui s'inscrit avec une adresse du domaine rejoint
     l'espace de travail comme membre ;
   - **imposer l'authentification unique** : ses adresses se connectent uniquement avec votre fournisseur,
     sans mot de passe ni lien par e-mail. Vérifiez que le fournisseur fonctionne pour vous avant de
     l'activer.
2. **Les fournisseurs d'identité**, OpenID Connect ou SAML (Okta, Entra ID, Google Workspace, Keycloak…),
   pour les adresses de vos domaines vérifiés. La page donne l'URI de redirection ou l'URL de réponse (ACS)
   et l'entity ID à saisir côté fournisseur.
3. **L'annuaire de l'entreprise (LDAP ou Active Directory).** Les personnes se connectent avec le mot de
   passe de leur annuaire. Ronde les recherche avec un compte de service et vérifie leur mot de passe sans
   le conserver. Utilisez `ldaps://`, ou `ldap://` avec StartTLS.
4. **Le provisionnement (SCIM).** Votre annuaire (Okta, Entra ID, JumpCloud…) crée les personnes, tient à
   jour leur nom et leur adresse, et les retire quand elles partent. L'onglet donne le point d'accès SCIM
   et un jeton.

Une instance derrière un proxy inverse qui authentifie peut plutôt se fier à l'adresse qu'il transmet dans
un en-tête (`AUTH_TRUSTED_EMAIL_HEADER`) ; ne le faites que si rien d'autre ne peut atteindre Ronde.

## Réunions

Les propriétaires et les administrateurs peuvent réserver la création de réunions aux organisateurs et administrateurs dans
l'onglet Général. Chaque réunion a ensuite ses propres réglages, ouverts à ses régisseurs : planification,
personnes et rôles, rubriques de la fiche, ordre du jour, modules, apparence, notifications, visio et
intégrations. Une réunion peut être enregistrée comme modèle de l'espace de travail, sans ses personnes,
son historique ni ses jetons.

Une réunion commence avec l'emoji de son modèle, affiché à côté de son nom dans les menus ; dans Réglages › Apparence, ses animateurs choisissent un autre emoji ou envoient une image (un logo, une photo d'équipe).

### Séances à la volée

**Démarrer maintenant**, sur la carte d'une réunion, tient une séance tout de suite, hors planification :
l'équipe est prévenue (cloche, et règles de notification « séance démarrée »), et la régie s'ouvre. La
séance est datée d'aujourd'hui ; la date prévue reste dans la planification. Démarrer depuis la régie une
séance préparée pour un autre jour fait la même chose.

### Réunion d'exemple

Avant sa première réunion, l'accueil d'un espace propose une réunion d'exemple : un point hebdo avec une équipe fictive de cinq personnes, un mois de séances archivées avec leurs comptes rendus, statistiques et actions, et une séance prête à lancer, le tout dans la langue de l'espace. Elle sert à tout essayer : elle n'envoie rien (ni rappel, ni e-mail, ni événement d'agenda, ni notification), ne compte pas dans la facturation, ne coche aucun des premiers pas et reste en dehors des analyses et des rapports de l'espace. Un bandeau le rappelle sur ses pages, et **Supprimer l'exemple** l'efface définitivement avec son équipe fictive (une personne de cette équipe ajoutée à une autre réunion est conservée). Ses personnes apparaissent comme Exemple dans l'annuaire et ne peuvent pas être invitées.

### Jours fériés

Dans l'onglet Général, un espace choisit les jours fériés d'un pays, et d'une région quand ils diffèrent (un Land allemand, une communauté espagnole…) ; un nouvel espace part de ceux du pays de son fuseau horaire. Une séance qui tombe un de ces jours est sautée : la date suivante est préparée, les rappels et les calendriers suivent, et le planning nomme le jour férié. Dans son planning, une réunion peut suivre d'autres jours fériés ou aucun, et la personne qui l'anime peut toujours maintenir ou déplacer chaque séance sautée. Les jours fériés viennent du projet date-holidays, d'après Wikipédia (CC BY-SA 3.0).

### Liens invités

Dans les réglages d'une réunion, **Personnes › Liens invités** crée un lien secret pour des personnes sans
compte (un client, un conseil, un partenaire). Il ouvre l'écran partagé, en direct et en lecture seule,
jusqu'à son expiration (1 à 90 jours) ou jusqu'à ce qu'un régisseur le révoque. Le lien n'est affiché
qu'une fois, à sa création ; Ronde n'en garde que l'empreinte.

### Projets et portefeuille

La page **Projets** d'un espace contient son portefeuille : chaque projet, sujet ou chantier, avec un
résumé d'une ligne, une description, un thème, un statut, une météo (en bonne voie, à risque, en
difficulté), un responsable, les personnes qui y travaillent, des dates et des liens. Les membres peuvent
créer des projets ; leur responsable et les admins les modifient. La page d'un projet rassemble ce que
chaque réunion en a dit, séance après séance, pour les personnes qui peuvent lire ces réunions.

Chaque projet peut avoir un logo, à côté de son nom et sur son étape en réunion : cliquez sur sa pastille, sur la page du projet, pour choisir une image ; sans logo, ses initiales s’affichent sur sa couleur. Un import reprend l’image de l’outil : l’avatar d’une organisation GitHub, celui d’un projet GitLab ou d’un projet Jira. Ceux qui peuvent modifier le projet le changent ou le retirent.

Une réunion suit des projets dans **Réglages › Projets**. Chaque projet suivi a un onglet dans la fiche de
chacun, avec une fiche partagée : la météo et le message du jour, rédigés par les personnes qui y
travaillent. Ajoutez le bloc **Tour par projet** à l'ordre du jour pour donner à chaque projet son propre
tour, où ses membres parlent ensemble ; sans lui, les éléments sur un projet sont présentés au tour de
chaque personne. Les modèles **Revue de portefeuille** et **Équipe et projets** l'intègrent d'emblée. Avec
Team, un tableau de bord montre la météo de chaque projet semaine après semaine, les échéances et les
projets sans nouvelles, l'exporte en CSV et ajoute les projets à surveiller au rapport par e-mail. Avec Enterprise, un projet peut faire partie d'un autre, qui devient un programme (trois niveaux au plus), n'être visible que de ses membres, et être modifiable par ses membres, pas seulement par son responsable.

**Importer**, sur la même page, importe des projets de vos outils : les dépôts d’une organisation GitHub ou les projets d’un groupe GitLab, les jalons d’un dépôt GitHub ou d’un projet GitLab (chacun nommé « dépôt · jalon »), les epics d’un projet Jira, ou les projets de Linear. Cochez ceux à importer ; ceux déjà dans le portefeuille sont reconnus, et un élément n’est importé qu’une fois. Le jeton saisi ne sert qu’à cet import et n’est pas conservé :

- GitHub : aucun pour des dépôts publics ; pour des dépôts privés, un jeton « fine-grained » qui peut les lire (Metadata, et Issues pour les jalons).
- GitLab : aucun pour des groupes et projets publics ; sinon un jeton d’accès personnel, de groupe ou de projet avec la portée `read_api`.
- Jira : un jeton d’API du compte dont l’e-mail est saisi (id.atlassian.com › Sécurité › Jetons d’API).
- Linear : une clé d’API personnelle.

Les membres importent depuis github.com, gitlab.com, Atlassian Cloud et Linear ; importer depuis un autre serveur (GitHub Enterprise, un GitLab auto-hébergé, Jira Data Center) et via les outils de tickets enregistrés dans les réglages de l’espace est réservé aux administrateurs de l’espace. Avec Team, un import via un tel outil garde les projets synchronisés toutes les heures : leur nom, leur statut, leurs dates et leur avancement suivent l’outil, ce que l’outil ne donne pas reste tel que réglé dans Ronde (un dépôt donne son nom, et passe à « Terminé » une fois archivé), et leur avancement s’affiche sur les cartes et en réunion tant qu’il est à jour. La page du projet propose **Mettre à jour** et **Ne plus synchroniser**. La synchronisation s’arrête définitivement avec **Ne plus synchroniser**, quand l’outil de tickets est retiré ou pointe vers un autre serveur, et se met en pause tant que l’espace n’est pas sur Team. Un élément que l’outil ne trouve plus (supprimé, ou hors de portée du jeton) est réessayé une fois par jour. Un projet archivé n'est plus mis à jour jusqu'à ce qu'il soit restauré.

### Modules

Tous les modules d'animation sont gratuits : brise-glace, météo d'équipe, vote d'utilité, réactions, mains levées, kudos,
mise en avant, roue et tirages au sort, anniversaires, sons, timebox, sondages, parking, journal des
décisions, rétrospective, planning poker et réunions asynchrones. Un module désactivé dans une réunion
disparaît de sa régie, de son écran partagé et des fiches ; ses réglages sont conservés.

Le vote d'utilité demande à chacun, à la clôture, si la réunion a été utile (1 à 5 étoiles, depuis son écran ou son téléphone). La moyenne s'affiche à partir de 3 notes, pour que personne ne puisse deviner la note d'un autre ; elle rejoint le compte rendu et les statistiques. Les modèles des réunions quotidiennes courtes, des tête-à-tête et des instances formelles (comité de pilotage, conseils d'administration, conseil de classe, réunion de chantier, réunion de concertation, revue d'incident) le laissent désactivé.

### Exports

Les pages qui listent quelque chose l'exportent pour un tableur : **Exporter en CSV** sur la page Actions
(toutes les actions de la vue, y compris celles faites il y a plus de deux semaines), la page Décisions
(avec sa recherche et son filtre par réunion), les Statistiques d'une réunion (une ligne par séance) et,
avec Team, le tableau des Analyses et le tableau de bord du portefeuille. Les comptes rendus se
téléchargent en Markdown ou en PDF depuis l'Historique. Les fichiers s'ouvrent directement en colonnes
dans Excel, LibreOffice ou Numbers, dans la langue de la personne (« ; » et virgule décimale en français,
allemand, espagnol, italien, portugais et russe), et un texte qui ressemble à une formule reste du texte.

## Notifications

Les **connecteurs** sont les canaux où les réunions peuvent publier : e-mail, Matrix (Tchap), Slack,
Microsoft Teams, Discord, Mattermost, ou un webhook signé avec HMAC. Les propriétaires et les
administrateurs les ajoutent dans l'onglet Général de l'espace de travail. Chaque réunion choisit ensuite,
dans ses réglages de notifications, quels événements vont vers quel connecteur : une séance bientôt,
démarrée ou terminée, un compte rendu publié, un rappel de fiche, une action en retard, un anniversaire.

Chaque lundi à partir de 8 h (fuseau de l'espace), chaque membre reçoit un **récapitulatif hebdomadaire** par
e-mail : ses séances de la semaine avec un lien vers chaque fiche, ses actions de suivi ouvertes et les bravos
reçus. Il n'est envoyé que s'il contient quelque chose ; chacun le désactive dans son compte ou avec le lien
en bas de l'e-mail. Sur une instance auto-hébergée, il faut `SMTP_URL` ; `RONDE_WEEKLY_PER_RUN` (150 par
défaut) limite les envois par heure, les autres partent l'heure suivante.

Avec Team, le constructeur de workflows ajoute des conditions et vos propres formulations à chaque message,
et deux connecteurs de plus envoient des **SMS** et des messages **WhatsApp** via Twilio : saisissez
l'Account SID, le numéro d'envoi et l'auth token. Les messages partent vers les numéros de mobile que les
personnes saisissent sur leur profil (format international, +33…), et jamais vers les personnes absentes.
Pour WhatsApp, l'expéditeur doit être approuvé dans Twilio ; en dehors d'une conversation lancée par la
personne, WhatsApp peut exiger un modèle de message approuvé.

**Fiche par e-mail** : quand l'instance lit une boîte (`INBOUND_IMAP_URL`, voir le guide d'auto-hébergement), la relance indique qu'on peut y répondre. Le nom de chaque rubrique sur une ligne, les éléments en dessous : les lignes s'ajoutent à la fiche de la personne (sans rien remplacer), et un e-mail confirme ce qui a été ajouté. Seules comptent les réponses venant de l'adresse de la relance (ou de celle du compte de la personne), pendant 14 jours ; les observateurs et la réunion d'exemple sont exclus.

**Notifications push** : une fois l'instance dotée de ses clés (voir le guide d'auto-hébergement), chacun peut installer Ronde depuis son navigateur (ou l'ajouter à l'écran d'accueil d'un iPhone) et, dans son compte, activer les notifications appareil par appareil : son tour qui approche pendant une séance en direct, les relances de fiche, et ce qui arrive dans la cloche. Chaque type peut être désactivé, et les appareils y sont listés.

## Intégrations

Les jetons et secrets saisis dans Ronde sont chiffrés avec `SECRET_KEY` avant d'être enregistrés, et ne
sont plus jamais affichés. Gardez cette clé en lieu sûr : sans elle, ils ne peuvent plus être relus.

Les jetons des comptes qui se connectent avec Google, GitHub, Microsoft ou l'authentification unique sont chiffrés eux aussi, avec `AUTH_SECRET`.

| Intégration | Où | Offre |
| --- | --- | --- |
| GitLab et GitHub : importer tickets et merge requests dans les fiches | Réglages de la réunion | Community |
| Visio : n'importe quel lien, Jitsi, BigBlueButton | Réglages de la réunion | Community |
| Salles Zoom, Google Meet et Teams créées pour chaque réunion | Espace de travail, Général | Team |
| Agendas Google, Outlook et CalDAV (iCloud, Fastmail, Nextcloud…), dans les deux sens : séances inscrites dans les agendas des participants, déplacements, suppressions et réponses faits là-bas repris ici, disponibilités lues | Espace de travail, Général | Team |
| Tickets Jira, Linear, GitLab et GitHub depuis les actions de suivi, fermés en même temps | Espace de travail, Général | Team |
| GitHub, GitLab, Jira et Linear : dépôts, jalons, epics et projets importés dans le portefeuille | Projets › Importer | Community |
| Projets importés synchronisés avec leur outil : nom, statut, dates et avancement | Projets › Importer, via un outil de tickets | Team |
| Votre logo sur l'écran partagé, dans les e-mails et les comptes rendus | Espace de travail, Général | Team |
| App Slack : rappels en message privé, fiches remplies depuis Slack, `/ronde`, un canal pour les notifications | Espace de travail, Général | Team |
| App Microsoft Teams : rappels par message personnel, fiches remplies depuis Teams, `ronde`, un canal pour les notifications | Espace de travail, Général | Team |
| Notion et Confluence : le compte rendu de chaque séance publié comme une page, mis à jour avec le résumé | Espace de travail, Général, puis Réglages de la réunion › Intégrations | Team |

### Slack

Avec Team, les propriétaires et administrateurs cliquent sur **Ajouter à Slack** dans l'onglet Général et
choisissent le canal des notifications. Ensuite :

- les rappels de fiche arrivent en message privé, avec un bouton **Remplir ma fiche** qui ouvre les
  rubriques de la réunion dans un formulaire Slack ; les réponses sont enregistrées dans Ronde comme si
  elles avaient été saisies sur la page ;
- le canal choisi devient un connecteur, prêt pour les règles de notification des réunions (compte rendu
  publié, séance qui approche…) ;
- `/ronde` montre à chacun ses prochaines séances et ses actions de suivi en cours, visibles de lui seul.

Les personnes sont reconnues par leur e-mail : leur compte Slack et leur profil Ronde doivent avoir le
même. Celles qui ne sont pas trouvées dans Slack gardent le rappel par e-mail. **Déconnecter** retire l'app
de Slack et supprime les règles de notification qui publient dans son canal. Sur une instance
auto-hébergée, l'administrateur crée d'abord l'app Slack de l'instance (voir le guide d'auto-hébergement).

### Microsoft Teams

Un propriétaire ou un administrateur télécharge l'app Ronde pour Teams depuis l'onglet Général ; un
administrateur Teams la charge dans les applications de l'organisation et l'ajoute à une équipe. Dans son
canal, Ronde publie une carte : **Lier à Ronde** ouvre Ronde, où l'on choisit l'espace. Dès lors, les rappels
de fiche partent par message personnel aux personnes trouvées dans l'équipe (reconnues par leur e-mail), avec
un bouton qui transforme le message en formulaire de la fiche ; écrire « ronde » à l'app liste les prochaines
séances et les actions ouvertes de la personne ; et le canal devient un connecteur pour les règles de
notification des réunions. Retirer l'app de l'équipe, ou **Délier** dans Ronde, arrête tout, et les rappels
repartent par e-mail.

### Notion et Confluence

Les propriétaires et administrateurs ajoutent un wiki dans l'onglet Général : une page **Notion** partagée
avec une intégration interne (créée sur notion.so/profile/integrations ; partagez la page avec elle depuis
••• › Connexions), ou un espace **Confluence**, dans le cloud (site, clé de l'espace, e-mail du compte et
jeton d'API créé sur id.atlassian.com) ou sur un Data Center ou un Server (jeton d'accès personnel). Une page
parente facultative regroupe les comptes rendus. Chaque réunion choisit ensuite son wiki dans Réglages ›
Intégrations : à chaque archivage, le compte rendu devient une page nommée par la date de la séance et le
nom de la réunion, avec un lien vers l'historique. Modifier le résumé met la page à jour ; les séances plus
anciennes se publient depuis l'historique, où une publication qui a échoué dit pourquoi et peut être
relancée. Les réunions d'exemple ne publient rien.

### Assistant IA et transcriptions

Avec Team, l'**assistant IA** rédige la synthèse d'une séance et propose des actions de suivi ; le
régisseur relit tout avant l'enregistrement. Il utilise une clé d'API Anthropic : celle de l'instance
(`ANTHROPIC_API_KEY`) ou celle de l'espace de travail.

Les **transcriptions** transforment en texte ce qui est dit pendant une séance, tour par tour. Elles
nécessitent un service de reconnaissance vocale : OpenAI, ou votre propre serveur Whisper (le profil
`whisper` du fichier Compose en lance un sur la même machine). Chaque réunion doit les autoriser dans ses
réglages, tout le monde voit un bandeau pendant qu'une séance est enregistrée, et chaque personne peut
exclure ses tours. Le son est supprimé dès qu'il est transcrit.

## Journal d'audit

Avec Team, l'onglet **Journal d'audit** liste qui a modifié quoi dans l'espace de travail ces 90 derniers
jours : réglages, personnes, rôles et réunions, avec un export CSV. Enterprise garde tout l'historique et peut
envoyer chaque entrée, signée, vers un connecteur webhook pour votre SIEM ou votre plateforme de journaux.

## Sauvegardes et mises à jour

Tout ce que Ronde conserve se trouve dans sa base PostgreSQL. Le
[guide d'auto-hébergement](../self-hosting/README.fr.md#backups) explique comment la sauvegarder, la
restaurer et passer à une nouvelle version.
