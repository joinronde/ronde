# Héberger Ronde soi-même

Ronde tourne sur n'importe quelle machine équipée de Docker : l'application, une base PostgreSQL et un
conteneur ponctuel qui applique les migrations de la base à chaque version. Tout ce que contient l'édition
Community est gratuit, sans limite de réunions ni de personnes. Une clé de licence active les fonctions
Team ou Enterprise.

## Démarrer

1. Récupérez les fichiers :

   ```sh
   mkdir ronde && cd ronde
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/compose.yml
   curl -fsSL https://raw.githubusercontent.com/joinronde/ronde/main/docker/.env.example -o .env
   ```

2. Remplissez `.env` : indiquez l'adresse que les gens ouvriront (`RONDE_URL`), puis générez les trois secrets :

   ```sh
   for v in POSTGRES_PASSWORD AUTH_SECRET SECRET_KEY; do sed -i "s|^$v=.*|$v=$(openssl rand -base64 32 | tr -d '/+=')|" .env; done
   ```

3. Démarrez :

   ```sh
   docker compose up -d
   ```

4. Ouvrez `RONDE_URL` et créez le premier compte : il devient l'administrateur de l'instance.

## HTTPS

Faites pointer un domaine vers la machine, renseignez `RONDE_DOMAIN=ronde.example.com` et
`RONDE_URL=https://ronde.example.com` dans `.env`, puis démarrez avec le profil `https`. Caddy obtient et
renouvelle le certificat.

```sh
docker compose --profile https up -d
```

Si vous utilisez plutôt votre propre proxy inverse, redirigez vers le port `RONDE_PORT` (3000 par défaut) et
conservez les en-têtes `X-Forwarded-*`. Les Server-Sent Events ne doivent pas être mis en tampon
(`proxy_buffering off` avec nginx).

## E-mail

Les liens de connexion, les invitations et les rappels ont besoin d'un serveur SMTP :
`SMTP_URL=smtp://user:password@smtp.example.com:587` et `MAIL_FROM`. Pour un essai, le profil `mail`
démarre Mailpit, qui intercepte tous les e-mails :

```sh
echo "SMTP_URL=smtp://mail:1025" >> .env
docker compose --profile mail up -d   # emails at http://localhost:8025
```

Pour que chacun puisse remplir sa fiche en répondant au rappel, donnez à Ronde une boîte aux lettres à lire : `INBOUND_IMAP_URL=imaps://user:password@imap.example.com:993/INBOX`, et `INBOUND_ADDRESS` quand l'identifiant n'est pas l'adresse e-mail. Les réponses y sont envoyées ; chaque minute, Ronde lit celles qui répondent à un rappel, ajoute leurs lignes à la fiche, confirme par e-mail et les range dans un dossier `Ronde`. Les autres messages de la boîte restent tels quels : ce peut être votre adresse de contact habituelle.

Les notifications push (votre tour qui approche, les rappels de fiche, la cloche) demandent une paire de clés pour l'instance : générez-les avec `npx web-push generate-vapid-keys`, puis renseignez `WEB_PUSH_PUBLIC_KEY` et `WEB_PUSH_PRIVATE_KEY`. Conservez-les : les appareils qui ont activé les notifications en dépendent. Ronde doit être servi en HTTPS ; sur iPhone, chacun l'ajoute d'abord à l'écran d'accueil.

## Connexion

Les comptes locaux et les liens de connexion par e-mail fonctionnent d'emblée. `SIGNUP_POLICY` décide qui peut créer un
compte : `invite-only` (par défaut), `open`, ou `domains` avec `SIGNUP_ALLOWED_DOMAINS`. Un fournisseur
OpenID Connect (Keycloak, Authentik, Entra ID, Okta…) se configure avec les variables `OIDC_*` ; Google,
GitHub et Microsoft avec leurs `<PROVIDER>_CLIENT_ID` et `<PROVIDER>_CLIENT_SECRET`. URI de redirection :
`<RONDE_URL>/api/auth/callback/<provider>`.

## Transcriptions sans envoyer le son ailleurs

Les transcriptions (Team) utilisent un service de reconnaissance vocale compatible avec l'API d'OpenAI.
Pour garder le son sur vos serveurs, démarrez le profil `whisper` et indiquez-le à Ronde :

```sh
cat >> .env <<'ENV'
TRANSCRIPTION_URL=http://whisper:8000/v1
TRANSCRIPTION_MODEL=Systran/faster-whisper-small
ENV
docker compose --profile whisper up -d
```

## Slack

Avec une licence Team ou Enterprise, les espaces de travail peuvent ajouter Ronde à Slack : rappels de
fiche en message privé, fiches remplies depuis un formulaire Slack, notifications dans un canal et
commande `/ronde`. L'instance a besoin de sa propre app Slack, créée une seule fois. Slack doit pouvoir
joindre `RONDE_URL` en HTTPS.

1. Récupérez le manifeste de l'app et remplacez-y chaque `https://ronde.example.com` par votre `RONDE_URL` :

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/slack-manifest.yml
   ```

2. Sur [api.slack.com/apps](https://api.slack.com/apps) : **Create New App › From a manifest**, choisissez
   votre espace Slack et collez le fichier.
3. Copiez les clés de **Basic Information › App Credentials** dans `.env` (`SLACK_CLIENT_ID`,
   `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`), puis lancez `docker compose up -d`.
4. Dans Ronde, un propriétaire ou administrateur de chaque espace ouvre **Réglages › Slack › Ajouter à Slack**.

Pour ajouter l'app à plusieurs espaces Slack, activez **Manage Distribution** dans les réglages de l'app.

## Microsoft Teams

Avec une licence Team ou Enterprise, les espaces de travail peuvent ajouter Ronde à Microsoft Teams : rappels
de fiche par message personnel, fiches remplies depuis une carte, notifications dans un canal, et la commande
`ronde`. L'instance a besoin de sa propre app Teams, un Azure Bot enregistré une seule fois dans votre organisation
Microsoft. Microsoft doit pouvoir joindre `RONDE_URL` en HTTPS.

1. Dans le [portail Azure](https://portal.azure.com) : **Create a resource › Azure Bot**, avec un identifiant
   (`ronde`), l'offre gratuite **F0**, **Type of App: Single Tenant** et **Create new Microsoft App ID**.
2. Dans le bot, **Settings › Configuration** : indiquez comme **Messaging endpoint**
   `https://ronde.example.com/api/teams/messages` (votre `RONDE_URL`), enregistrez, et copiez le **Microsoft
   App ID** et l'**App Tenant ID**.
3. **Manage Password**, sur la même page, ouvre l'inscription de l'application : **Certificates & secrets ›
   New client secret**, puis copiez sa **Value** (affichée une seule fois).
4. Dans le bot, **Settings › Channels** : ajoutez **Microsoft Teams** et acceptez ses conditions.
5. Mettez les trois valeurs dans `.env` (`TEAMS_APP_ID`, `TEAMS_TENANT_ID`, `TEAMS_APP_PASSWORD`), puis lancez
   `docker compose up -d`.
6. Dans Ronde, un propriétaire ou un administrateur d'un espace ouvre **Réglages › Microsoft Teams** et
   télécharge l'app. Un administrateur Teams la charge (centre d'administration Teams › Applications Teams ›
   Gérer les applications › Charger une nouvelle application) et l'ajoute à une équipe : Ronde publie une carte
   dans son canal, et **Lier à Ronde** choisit l'espace.

Le secret client expire au bout de 6 à 24 mois : créez-en un nouveau avant son expiration, et remplacez `TEAMS_APP_PASSWORD`. Un
bot à locataire unique (single tenant) sert les personnes de votre propre organisation Microsoft ; pour proposer l'app à d'autres
organisations, elle doit être publiée dans le Teams Store.

## Mettre à jour

```sh
docker compose pull && docker compose up -d
```

Le conteneur `migrate` applique les migrations de la nouvelle version avant le démarrage de l'application.
Fixez une version avec `RONDE_VERSION=1.0.0-beta.3` dans `.env` pour choisir quand mettre à jour.

## Sauvegardes

Tout se trouve dans le volume PostgreSQL :

```sh
docker compose exec db pg_dump -U ronde ronde | gzip > ronde-$(date +%F).sql.gz
```

## Images

| Image | Ce que c'est |
|---|---|
| `ghcr.io/joinronde/ronde` | L'application, toutes éditions confondues (fonctions payantes désactivées sans licence) |
| `ghcr.io/joinronde/ronde-ce` | L'application sans le code des éditions payantes (AGPL uniquement) |
| `ghcr.io/joinronde/ronde-migrate` | Les migrations de la base pour la même version |

Chaque variable secrète accepte aussi `<NAME>_FILE` (secrets Docker). Éducation : les écoles et les
universités bénéficient gratuitement des offres payantes ; faites-en la demande sur https://joinronde.com/fr/education.
