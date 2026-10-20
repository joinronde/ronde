# Ronde verwalten

Diese Anleitung richtet sich an alle, die Ronde für eine Organisation betreiben: die Administration einer
selbst gehosteten Instanz sowie Inhaber und Admins eines Arbeitsbereichs (in der Cloud oder auf deinem
eigenen Server). Um Ronde zu installieren, beginne mit der
[Anleitung zum Selbsthosten](../self-hosting/README.de.md).

## Die Instanz

Das erste Konto, das auf einer neuen Instanz angelegt wird, übernimmt ihre **Administration**. Es öffnet
**Serververwaltung** im Menü des Arbeitsbereichs oben links (`/admin`) und kann dort:

- sehen, wie viele Konten, Arbeitsbereiche und Meetings die Instanz enthält;
- die Standardsprache wählen, die gilt, wenn weder die Person noch ihr Browser eine Sprache verlangt, die
  Ronde spricht;
- festlegen, wer ein Konto anlegen darf;
- den Lizenzschlüssel eintragen oder entfernen.

Auf dieser Seite gespeicherte Werte haben Vorrang vor den Umgebungsvariablen. Die eigenen
Einstellungen jedes Arbeitsbereichs (Mitglieder, Rollen, Sicherheit) bleiben in dessen **Einstellungen**.

In der Cloud betreibt das Ronde-Team den Server: Es gibt keine Serververwaltung, alle können ein Konto
anlegen, und der Tarif jedes Arbeitsbereichs ergibt sich aus seinem Abonnement.

### Wer ein Konto anlegen darf

| Regel | Wer sich registrieren darf |
| --- | --- |
| Auf Einladung (Standard) | Nur Personen, die in einen Arbeitsbereich eingeladen wurden |
| E-Mail-Domains | Eingeladene Personen und alle mit einer Adresse der aufgeführten Domains |
| Offen | Alle, die die Instanz erreichen |

Dieselbe Wahl lässt sich mit `SIGNUP_POLICY` (`invite-only`, `domains`, `open`) und
`SIGNUP_ALLOWED_DOMAINS` treffen.

### Lizenzschlüssel

Die Funktionen von Team und Enterprise werden mit einem Lizenzschlüssel freigeschaltet, eingetragen in der
Serververwaltung oder über die Variable `RONDE_LICENSE` (die Variable hat Vorrang und sperrt das Feld).
Der Schlüssel wird auf dem Server offline geprüft: Nichts wird irgendwohin gesendet. Die Seite zeigt den
Tarif, den Kunden, das Ablaufdatum und wie viele Plätze belegt sind.

- **Ein Platz** ist eine Person, die in den letzten 30 Tagen an einem Meeting teilgenommen hat, wie in der Cloud
  von Ronde. Wer eingeladen wurde und nie kam oder den ganzen Monat abwesend war, belegt keinen, und eine Person in
  mehreren Arbeitsbereichen (mit demselben Konto oder derselben Adresse) zählt einmal.
- **Der Höchststand** jeder Lizenz wird festgehalten, solange sie gilt (aktiv oder in ihrer Schonfrist), gezählt
  jede Nacht und bei jedem Aufruf der Seite. Nach ihm richtet sich die Verlängerung. Ein neuer Schlüssel beginnt
  seine eigene Zählung, und die Seite zeigt weiterhin den Höchststand der vorigen Lizenz, um sie abzurechnen.
- **Mehr Personen als Plätze**: Nichts wird gesperrt. Die Seite weist darauf hin, und die Differenz wird bei der
  Verlängerung abgerechnet.
- **Abgelaufen**: Eine Schonfrist von 14 Tagen hält alles am Laufen. Danach werden die kostenpflichtigen
  Funktionen schreibgeschützt: Ihre Inhalte bleiben lesbar, Neues kann nicht hinzugefügt werden.
  Community-Funktionen sind nie betroffen.
- Das Image `ronde-ce` wird nur aus dem Open-Source-Code gebaut und kann keinen Lizenzschlüssel lesen:
  Nutze für Team oder Enterprise das Image `ronde`.

Schulen und Hochschulen bekommen eine kostenlose Enterprise-Lizenz: Schreib an hello@joinronde.com von der
Adresse deiner Einrichtung.

### Kostenpflichtige Tarife ausblenden

Admins sehen in den Einstellungen dezente Hinweise auf kostenpflichtige Funktionen (nie während eines
Meetings). Setze `RONDE_HIDE_UPGRADE_HINTS=1`, um sie für die ganze Instanz zu entfernen.

### Feedback der Nutzenden

Über den Sprechblasen-Button oben auf den Seiten (auf dem Handy im Kontomenü) können Leute ein Problem melden oder
eine Idee teilen, auf Wunsch mit Screenshot. Mit der Nachricht gehen die Adresse der Seite (ohne Parameter), der
Browser, die Fenstergröße, die Sprache und die Ronde-Version mit. Die Administration der Instanz liest die Nachrichten unter
**Serververwaltung**, antwortet per E-Mail, wenn die Person es wünscht, und kann für ein Problem von Ronde selbst
ein vorausgefülltes Issue im Ronde-Projekt öffnen. Ist `SENTRY_DSN` gesetzt, landen die Nachrichten auch als User
Feedback in diesem Sentry-Projekt. Nachrichten werden nach einem Jahr gelöscht; auf einer selbst gehosteten Instanz ist der
Button standardmäßig aus: `RONDE_FEEDBACK=on` zeigt ihn an.

## Arbeitsbereiche

Ein Arbeitsbereich bündelt die Personen, Meetings, Vorlagen und Connectors eines Teams. Alle, die sich
registrieren dürfen, können einen anlegen; eine Person kann zu mehreren gehören. Seine Einstellungen findest
du unter **Einstellungen** in der Seitenleiste:

| Tab | Was er enthält | Wer ihn sieht |
| --- | --- | --- |
| Allgemein | Name, Link, Sprache, Berufsgruppen, wer Meetings anlegen darf, Connectors und Integrationen | Alle; Inhaber und Admins ändern ihn |
| Sicherheit | Verifizierte Domains, Identitätsanbieter, LDAP, SCIM | Inhaber und Admins (Enterprise) |
| Rollen | Eigene Rollen | Inhaber und Admins (Enterprise) |
| Audit-Log | Wer was geändert hat | Inhaber und Admins (Team, Enterprise) |
| Abrechnung | Tarif und Rechnungen | Inhaber und die Rolle Abrechnung, in der Cloud |
| Tarife | Was Team und Enterprise hinzufügen und wo es sie gibt | Inhaber und Admins, selbst gehostet |

### Rollen

Jedes Mitglied hat eine Rolle im Arbeitsbereich:

| Rolle | Darf |
| --- | --- |
| Inhaber | Alles, einschließlich Abrechnung und Löschen des Arbeitsbereichs |
| Admin | Alles außer Abrechnung und Löschen; handelt als Moderation jedes Meetings |
| Abrechnung | Tarif, Rechnungen und Zahlungsmittel, sonst nichts (in der Cloud) |
| Organisator | Was ein Mitglied darf, dazu Meetings anlegen, wenn das Admins vorbehalten ist, und Personen einladen |
| Mitglied | Das Verzeichnis sehen, Meetings anlegen (außer wenn es Organisatoren und Admins vorbehalten ist), Vorlagen speichern |
| Gast | Nur die Meetings, zu denen er eingeladen ist |

Jede Person in einem Meeting hat außerdem eine Rolle in diesem Meeting:

| Rolle | Darf |
| --- | --- |
| Moderation | Sitzungen leiten, das Meeting einrichten, seine Personen verwalten, das Protokoll bearbeiten |
| Co-Moderation | Sitzungen leiten und das Protokoll bearbeiten, ohne Einstellungen oder Personen des Meetings zu ändern |
| Teilnehmend | Den eigenen Check-in ausfüllen, an Sitzungen teilnehmen, den Verlauf lesen |
| Beobachtend | Sitzungen verfolgen und den Verlauf lesen |

Wer ein Meeting anlegt, übernimmt seine Moderation. Mit Enterprise geben **eigene Rollen** Mitgliedern und
Gästen zusätzliche Berechtigungen; ihre Meeting-Berechtigungen gelten für alle Meetings des Arbeitsbereichs.

### Personen und Einladungen

Das **Verzeichnis** wird von allen Meetings des Arbeitsbereichs geteilt: Name, Geburtstag (nur Tag und
Monat), Berufsgruppe und Konten bei GitLab oder GitHub einer Person werden nur einmal eingetragen. Personen
können ohne Konto hinzugefügt werden, für ein Meeting, bei dem sie sich nicht anmelden; eine Einladung
verschickt eine E-Mail mit einem Link, der 14 Tage gültig ist. Wird ein Mitglied entfernt, endet sein
Zugang; seine Check-ins und sein Verlauf bleiben im Arbeitsbereich. Mit SCIM verlieren Personen, die in
deinem Verzeichnis deaktiviert werden, ihren Zugang auf dieselbe Weise.

### Abwesenheiten

Jede Person kann ihre Abwesenheiten in ihrem Profil eintragen (wer Personen verwaltet, kann das für alle
tun): einen ersten und einen letzten Tag, eine Notiz und wer in der Zeit die Meetings leitet, die sie
moderiert. Während einer Abwesenheit wird die Person für die Sitzungen dieser Tage als abwesend markiert,
bekommt keine Erinnerungen, und ihr Profil zeigt, wann sie zurück ist. Die als Vertretung eingetragene
Person wird benachrichtigt und leitet diese Meetings als Moderation, nur an diesen Tagen.

### Puffer zwischen Meetings

Im Tab Allgemein bleibt der **Puffer zwischen zwei Meetings** (keiner, 5, 10, 15 oder 30 Minuten) vor und
nach jedem Meeting einer Person frei. „Termin finden“ berücksichtigt ihn, und der Terminplan eines Meetings
markiert die Termine, die einem anderen Meeting derselben Personen zu nahe kommen.

## Anmeldung und Single Sign-on

Die Community-Edition bietet Konten mit E-Mail und Passwort, Anmeldelinks per E-Mail,
zweistufige Verifizierung, Konten von Google, GitHub und Microsoft sowie einen OpenID-Connect-Anbieter
für die Instanz (Variablen `OIDC_*`, siehe [Anleitung zum Selbsthosten](../self-hosting/README.de.md)).

Jede Person verwaltet ihre Anmeldung in ihrem Konto unter **Anmeldung und Sicherheit**: Passwort, Passkeys (Face ID, Windows Hello, ein Passwortmanager oder ein Sicherheitsschlüssel), zweistufige Verifizierung und überall abmelden. Passkeys sind an die Domain von `APP_URL` gebunden, die HTTPS nutzen muss: Nach einem Domainwechsel fügt jede Person sie erneut hinzu. Eine Adresse mit Pflicht zum Single Sign-on kann Passkeys weder hinzufügen noch nutzen.

Mit Enterprise kommt im Tab **Sicherheit** eines Arbeitsbereichs hinzu:

1. **Verifizierte Domains.** Füge deine E-Mail-Domain und den angezeigten DNS-Eintrag hinzu und verifiziere
   sie. Eine verifizierte Domain kann:
   - **neue Konten übernehmen**: Wer sich mit einer Adresse der Domain registriert, tritt dem Arbeitsbereich
     als Mitglied bei;
   - **Single Sign-on verlangen**: Ihre Adressen melden sich nur über deinen Anbieter an, ohne Passwort und
     ohne E-Mail-Link. Prüfe vor dem Einschalten, dass der Anbieter bei dir funktioniert.
2. **Identitätsanbieter**, OpenID Connect oder SAML (Okta, Entra ID, Google Workspace, Keycloak…), für die
   Adressen deiner verifizierten Domains. Die Seite nennt die Weiterleitungs-URI oder die Antwort-URL (ACS)
   und die Entity-ID, die beim Anbieter einzutragen sind.
3. **Unternehmensverzeichnis (LDAP oder Active Directory).** Personen melden sich mit ihrem
   Verzeichnispasswort an. Ronde sucht sie mit einem Dienstkonto und prüft ihr Passwort, ohne es zu
   speichern. Nutze `ldaps://` oder `ldap://` mit StartTLS.
4. **Bereitstellung (SCIM).** Dein Verzeichnis (Okta, Entra ID, JumpCloud…) legt Personen an, hält Name und
   Adresse aktuell und entfernt sie beim Austritt. Der Tab nennt den SCIM-Endpunkt und ein Token.

Eine Instanz hinter einem authentifizierenden Reverse Proxy kann stattdessen der Adresse vertrauen, die er
in einem Header mitgibt (`AUTH_TRUSTED_EMAIL_HEADER`); tu das nur, wenn nichts anderes Ronde erreichen kann.

## Meetings

Inhaber und Admins können das Anlegen von Meetings im Tab Allgemein auf Organisatoren und Admins beschränken. Jedes Meeting
hat dann eigene Einstellungen, offen für seine Moderation: Termine, Personen und Rollen, Abschnitte des
Check-ins, Agenda, Module, Aussehen, Benachrichtigungen, Videoanruf und Integrationen. Ein Meeting lässt
sich als Vorlage des Arbeitsbereichs speichern, ohne seine Personen, seinen Verlauf oder seine Tokens.

Ein Meeting beginnt mit dem Emoji seiner Vorlage, das neben seinem Namen in den Menüs erscheint; unter Einstellungen › Aussehen wählt die Moderation ein anderes Emoji oder lädt ein Bild hoch (ein Logo, ein Teamfoto).

### Spontane Sitzungen

**Jetzt starten** auf der Karte eines Meetings hält sofort eine Sitzung ab, außerhalb des Terminplans: Das
Team wird benachrichtigt (Glocke und die Benachrichtigungsregeln „Sitzung gestartet“), und die Regie öffnet
sich. Die Sitzung trägt das heutige Datum; der geplante Termin bleibt im Terminplan. Wird in der Regie eine
für einen anderen Tag vorbereitete Sitzung gestartet, passiert dasselbe.

### Beispiel-Meeting

Vor dem ersten Meeting bietet die Startseite eines Arbeitsbereichs ein Beispiel-Meeting an: eine Wochenrunde mit einem fiktiven Team aus fünf Personen, einem Monat archivierter Sitzungen mit Protokollen, Statistiken und Aufgaben und einer startbereiten Sitzung, alles in der Sprache des Arbeitsbereichs. Es dient zum Ausprobieren: Es sendet nichts (keine Erinnerung, keine E-Mail, keinen Kalendereintrag, keine Benachrichtigung), kostet keinen Platz, hakt keinen der ersten Schritte ab und bleibt aus den Auswertungen und Berichten des Arbeitsbereichs heraus. Ein Banner auf seinen Seiten weist darauf hin, und **Beispiel löschen** entfernt es endgültig mit seinem fiktiven Team (eine Person dieses Teams, die einem anderen Meeting hinzugefügt wurde, bleibt erhalten). Seine Personen erscheinen im Verzeichnis als Beispiel und können nicht eingeladen werden.

### Feiertage

Im Tab Allgemein wählt ein Arbeitsbereich die Feiertage eines Landes und, wo sie abweichen, einer Region (ein Bundesland, eine spanische Autonome Gemeinschaft…); ein neuer Arbeitsbereich beginnt mit denen des Landes seiner Zeitzone. Eine Sitzung an einem dieser Tage entfällt: Der nächste Termin wird vorbereitet, Erinnerungen und Kalender folgen, und der Terminplan nennt den Feiertag. In seinem Terminplan kann ein Meeting anderen Feiertagen oder keinen folgen, und die Moderation kann jede ausgelassene Sitzung trotzdem abhalten oder verschieben. Die Feiertage stammen aus dem Projekt date-holidays, nach Wikipedia (CC BY-SA 3.0).

### Gastlinks

In den Einstellungen eines Meetings erstellt **Personen › Gastlinks** einen geheimen Link für Personen ohne
Konto (Kunden, ein Gremium, Partner). Er öffnet den geteilten Bildschirm live und schreibgeschützt, bis er
abläuft (1 bis 90 Tage) oder die Moderation ihn widerruft. Der Link wird nur einmal angezeigt, beim
Erstellen; Ronde speichert nur seinen Hash.

### Projekte und Portfolio

Die Seite **Projekte** eines Arbeitsbereichs enthält sein Portfolio: jedes Projekt, Thema oder Vorhaben mit einer
Zusammenfassung in einem Satz, einer Beschreibung, einem Thema, einem Status, einem Stand (im Plan,
gefährdet, in Schwierigkeiten), einer verantwortlichen Person, dem Team, Terminen und Links. Mitglieder
können Projekte anlegen; die verantwortliche Person und die Admins bearbeiten sie. Die Seite eines Projekts
sammelt, was jedes Meeting Sitzung für Sitzung darüber gesagt hat, für alle, die diese Meetings lesen
dürfen.

Jedes Projekt kann ein Logo haben, neben seinem Namen und auf seinem Schritt in Meetings: Klicke auf der Projektseite auf sein Zeichen, um ein Bild zu wählen; ohne Logo stehen seine Initialen auf seiner Farbe. Ein Import übernimmt das Bild des Tools: den Avatar einer GitHub-Organisation, eines GitLab- oder eines Jira-Projekts. Wer das Projekt bearbeiten darf, ändert oder entfernt es.

Ein Meeting folgt Projekten unter **Einstellungen › Projekte**. Jedes verfolgte Projekt bekommt einen
Tab im Check-in aller, mit einem gemeinsamen Projektblatt: Stand und Botschaft des Tages, geschrieben
vom Projektteam. Mit dem Block **Projektrunde** in der Agenda bekommt jedes Projekt seine eigene Runde, in
der sein Team gemeinsam spricht; ohne ihn werden die Einträge zu einem Projekt in der Runde jeder Person
vorgestellt. Die Vorlagen **Portfolio-Review** und **Team und Projekte** enthalten ihn bereits. Mit Team
zeigt ein Dashboard den Stand jedes Projekts Woche für Woche, die Fälligkeiten und die Projekte ohne
Neuigkeiten, exportiert ihn als CSV und nimmt die Projekte im Blick in den E-Mail-Bericht auf. Mit Enterprise kann ein Projekt zu einem anderen gehören, das so zum Programm wird (höchstens drei Ebenen), nur für sein Team sichtbar sein und von seinem Team bearbeitet werden, nicht nur von der verantwortlichen Person.

**Importieren** auf derselben Seite holt Projekte aus deinen Tools: die Repositorys einer GitHub-Organisation oder die Projekte einer GitLab-Gruppe, die Meilensteine eines GitHub-Repositorys oder eines GitLab-Projekts (jeweils „Repository · Meilenstein“ benannt), die Epics eines Jira-Projekts oder die Projekte von Linear. Wähle die zu übernehmenden aus; bereits im Portfolio vorhandene werden erkannt, und jedes Element wird nur einmal übernommen. Das dort eingegebene Token dient nur diesem Import und wird nicht gespeichert:

- GitHub: keines für öffentliche Repositorys; für private ein Fine-grained-Token, das sie lesen kann (Metadata, für Meilensteine auch Issues).
- GitLab: keines für öffentliche Gruppen und Projekte; sonst ein persönliches, Gruppen- oder Projekt-Zugriffstoken mit dem Scope `read_api`.
- Jira: ein API-Token des Kontos, dessen E-Mail angegeben ist (id.atlassian.com › Sicherheit › API-Token).
- Linear: ein persönlicher API-Schlüssel.

Mitglieder importieren von github.com, gitlab.com, Atlassian Cloud und Linear; der Import von einem anderen Server (GitHub Enterprise, ein selbst verwaltetes GitLab, Jira Data Center) und über die in den Einstellungen des Arbeitsbereichs gespeicherten Ticketsysteme ist den Admins des Arbeitsbereichs vorbehalten. Mit Team hält ein Import über ein solches Ticketsystem die Projekte stündlich synchron: Name, Status, Termine und Fortschritt folgen dem Tool, was das Tool nicht liefert, bleibt so, wie es in Ronde eingestellt ist (ein Repository liefert seinen Namen und wird nach der Archivierung auf „Abgeschlossen“ gesetzt), und der Fortschritt erscheint auf den Karten und in den Meetings, solange er aktuell ist. Die Projektseite bietet **Jetzt aktualisieren** und **Nicht mehr synchronisieren**. Die Synchronisierung endet endgültig mit **Nicht mehr synchronisieren** oder wenn das Ticketsystem entfernt wird oder auf einen anderen Server zeigt, und pausiert, solange der Arbeitsbereich nicht im Tarif Team ist. Ein Element, das das Tool nicht mehr findet (gelöscht oder außerhalb der Reichweite des Tokens), wird einmal am Tag erneut versucht. Archivierte Projekte werden erst nach ihrer Wiederherstellung wieder aktualisiert.

### Module

Alle Moderationsmodule sind kostenlos: Eisbrecher, Stimmung im Team, Nützlichkeitsbewertung, Reaktionen, Handmeldungen, Kudos,
Spotlight, Glücksrad und Auslosungen, Geburtstage, Sounds, Timebox, Umfragen, Parkplatz, Entscheidungslog,
Retrospektive, Planning Poker und asynchrone Meetings. Ein in einem Meeting ausgeschaltetes Modul
verschwindet aus seiner Regie, seinem geteilten Bildschirm und den Check-ins; seine Einstellungen bleiben
erhalten.

Die Nützlichkeitsbewertung fragt zum Abschluss alle, wie nützlich das Meeting war (1 bis 5 Sterne, am eigenen Bildschirm oder Handy). Der Durchschnitt erscheint ab 3 Bewertungen, damit niemand die Bewertung anderer erraten kann; er geht ins Protokoll und in die Statistiken ein. Die Vorlagen für kurze tägliche Meetings, Einzelgespräche und formelle Gremien (Lenkungsausschuss, Vorstände, Klassenkonferenz, Baubesprechung, Fallkonferenz, Incident-Review) lassen sie ausgeschaltet.

### Exporte

Seiten, die etwas auflisten, exportieren es für eine Tabellenkalkulation: **Als CSV exportieren** auf der
Seite Aufgaben (alle Aufgaben der Ansicht, auch die vor mehr als zwei Wochen erledigten), der Seite
Entscheidungen (mit Suche und Meeting-Filter), den Statistiken eines Meetings (eine Zeile pro Sitzung)
und, mit Team, der Tabelle der Auswertungen und dem Portfolio-Dashboard. Protokolle werden im Verlauf als
Markdown oder PDF heruntergeladen. Die Dateien öffnen sich in Excel, LibreOffice oder Numbers direkt in
Spalten, in der Sprache der Person (";" und Dezimalkomma auf Französisch, Deutsch, Spanisch,
Italienisch, Portugiesisch und Russisch), und ein Text, der wie eine Formel aussieht, bleibt Text.

## Benachrichtigungen

**Connectors** sind die Kanäle, in die Meetings posten können: E-Mail, Matrix (Tchap), Slack, Microsoft
Teams, Discord, Mattermost oder ein mit HMAC signierter Webhook. Inhaber und Admins fügen sie im Tab
Allgemein des Arbeitsbereichs hinzu. Jedes Meeting wählt dann in seinen Benachrichtigungseinstellungen,
welche Ereignisse an welchen Connector gehen: eine Sitzung beginnt bald, ist gestartet oder beendet, ein
Protokoll ist veröffentlicht, eine Check-in-Erinnerung, eine überfällige Aufgabe, ein Geburtstag.

Jeden Montag ab 8 Uhr (Zeitzone des Arbeitsbereichs) bekommt jedes Mitglied eine **Wochenübersicht** per
E-Mail: seine Sitzungen der Woche mit einem Link zu jedem Check-in, seine offenen Folgeaufgaben und die
erhaltenen Kudos. Sie geht nur raus, wenn etwas drinsteht; jede Person schaltet sie in ihrem Konto oder über
den Link am Ende der E-Mail ab. Auf einer selbst gehosteten Instanz braucht sie `SMTP_URL`;
`RONDE_WEEKLY_PER_RUN` (standardmäßig 150) begrenzt die Mails pro Stunde, der Rest geht in der nächsten
Stunde.

Mit Team ergänzen Benachrichtigungs-Workflows jede Nachricht um Bedingungen und eigene Formulierungen, und
zwei weitere Connectoren senden **SMS** und **WhatsApp**-Nachrichten über Twilio: Trag die Account SID, die
Absendernummer und das Auth Token ein. Die Nachrichten gehen an die Mobilnummern, die Personen in ihrem Profil
angeben (internationales Format, +49…), nie an abwesende Personen. Für WhatsApp muss der Absender in Twilio
genehmigt sein, und WhatsApp lässt ein Unternehmen nur mit einer von Meta genehmigten Vorlage zuerst
schreiben: Leg im Content Template Builder von Twilio eine mit zwei Variablen an (die Nachricht, dann der
Link) und trag ihre Content SID im Connector ein. Verlässt ein Arbeitsbereich Team, hören diese Nachrichten
auf, und das Benachrichtigungsprotokoll jedes Meetings nennt den Grund.

**Check-in per E-Mail**: Wenn die Instanz ein Postfach liest (`INBOUND_IMAP_URL`, siehe die Anleitung zum Selbsthosten), sagt die Erinnerung, dass eine Antwort genügt. Der Name jedes Abschnitts in einer Zeile, die Punkte darunter: Die Zeilen werden dem Check-in der Person hinzugefügt (ohne etwas zu ersetzen), und eine E-Mail bestätigt, was hinzukam. Es zählen nur Antworten von der Adresse der Erinnerung (oder der des Kontos der Person), 14 Tage lang; Beobachtende und das Beispiel-Meeting sind ausgenommen.

**Push-Benachrichtigungen**: Sobald die Instanz ihre Schlüssel hat (siehe die Anleitung zum Selbsthosten), kann jede Person Ronde aus dem Browser installieren (oder auf dem iPhone zum Home-Bildschirm hinzufügen) und in ihrem Konto die Benachrichtigungen pro Gerät aktivieren: wenn man in einer Live-Sitzung bald dran ist, Erinnerungen an den Check-in und was in der Glocke landet. Jede Art lässt sich abschalten, die Geräte werden dort aufgelistet.

## Integrationen

In Ronde eingetragene Tokens und Secrets werden vor dem Speichern mit `SECRET_KEY` verschlüsselt und nie
wieder angezeigt. Bewahre diesen Schlüssel sicher auf: Ohne ihn lassen sie sich nicht mehr lesen.

Auch die Tokens von Konten, die sich mit Google, GitHub, Microsoft oder Single Sign-on anmelden, werden verschlüsselt, mit `AUTH_SECRET`.

| Integration | Wo | Tarif |
| --- | --- | --- |
| GitLab und GitHub: Issues und Merge Requests in Check-ins importieren | Einstellungen des Meetings | Community |
| Videoanruf: beliebiger Link, Jitsi, BigBlueButton | Einstellungen des Meetings | Community |
| Räume in Zoom, Google Meet und Teams für jedes Meeting angelegt | Arbeitsbereich, Allgemein | Team |
| Google-, Outlook- und CalDAV-Kalender (iCloud, Fastmail, Nextcloud…), in beide Richtungen: Sitzungen in die Kalender der Teilnehmenden geschrieben, dort gemachte Verschiebungen, Löschungen und Antworten übernommen, Verfügbarkeit gelesen | Arbeitsbereich, Allgemein | Team |
| Tickets in Jira, Linear, GitLab und GitHub aus Folgeaufgaben, synchron geschlossen | Arbeitsbereich, Allgemein | Team |
| GitHub, GitLab, Jira und Linear: Repositorys, Meilensteine, Epics und Projekte ins Portfolio importiert | Projekte › Importieren | Community |
| Importierte Projekte bleiben mit ihrem Tool synchron: Name, Status, Termine und Fortschritt | Projekte › Importieren, über ein Ticketsystem | Team |
| Dein Logo auf dem geteilten Bildschirm, in E-Mails und Protokollen | Arbeitsbereich, Allgemein | Team |
| Slack-App: Erinnerungen per Direktnachricht, Check-ins direkt in Slack, `/ronde`, ein Kanal für Benachrichtigungen | Arbeitsbereich, Allgemein | Team |
| Microsoft-Teams-App: Erinnerungen per persönlicher Nachricht, Check-ins aus Teams, `ronde`, ein Kanal für Benachrichtigungen | Arbeitsbereich, Allgemein | Team |
| Notion und Confluence: das Protokoll jeder Sitzung als Seite veröffentlicht, mit der Zusammenfassung aktualisiert | Arbeitsbereich, Allgemein, dann Meeting-Einstellungen › Integrationen | Team |

### Slack

Mit Team klicken Inhaber und Admins im Tab Allgemein auf **Zu Slack hinzufügen** und wählen den Kanal für
Benachrichtigungen. Danach:

- Check-in-Erinnerungen kommen per Direktnachricht, mit einer Schaltfläche **Meinen Check-in ausfüllen**,
  die die Abschnitte des Meetings in einem Slack-Formular öffnet; die Antworten werden in Ronde
  gespeichert, als wären sie auf der Seite eingegeben worden;
- der gewählte Kanal wird zu einem Connector, bereit für die Benachrichtigungsregeln der Meetings
  (Protokoll veröffentlicht, Sitzung beginnt bald…);
- `/ronde` zeigt allen ihre nächsten Sitzungen und offenen Folgeaufgaben, nur für sie sichtbar.

Personen werden an ihrer E-Mail erkannt: Ihr Slack-Konto und ihr Ronde-Profil müssen dieselbe haben. Wer
in Slack nicht gefunden wird, erhält die Erinnerung weiter per E-Mail. **Trennen** entfernt die App aus
Slack und löscht die Benachrichtigungsregeln, die in ihren Kanal posten. Auf einer selbst gehosteten
Instanz legt die Administration zuerst die Slack-App der Instanz an (siehe die Anleitung zum Selbsthosten).

### Microsoft Teams

Ein Inhaber oder Admin lädt die Ronde-App für Teams im Tab Allgemein herunter; ein Teams-Admin lädt sie
in die Apps der Organisation hoch und fügt sie einem Team hinzu. In dessen Kanal veröffentlicht Ronde eine
Karte: **Mit Ronde verknüpfen** öffnet Ronde, wo der Arbeitsbereich gewählt wird. Danach gehen die
Check-in-Erinnerungen per persönlicher Nachricht an die Personen, die im Team gefunden werden (erkannt an ihrer
E-Mail), mit einer Schaltfläche, die die Nachricht in das Formular des Check-ins verwandelt; wer der App
„ronde“ schreibt, sieht die eigenen nächsten Sitzungen und offenen Aufgaben; und der Kanal wird zum Connector
für die Benachrichtigungsregeln der Meetings. Die App aus dem Team zu entfernen oder **Verknüpfung lösen** in
Ronde beendet alles, und die Erinnerungen kommen wieder per E-Mail.

### Notion und Confluence

Inhaber und Admins fügen im Tab Allgemein ein Wiki hinzu: eine **Notion**-Seite, die mit einer internen
Integration geteilt ist (angelegt unter notion.so/profile/integrations; teile die Seite über
••• › Verbindungen mit ihr), oder einen **Confluence**-Bereich, in der Cloud (Site, Bereichsschlüssel,
E-Mail des Kontos und ein API-Token von id.atlassian.com) oder auf einem Data Center oder Server (ein
persönliches Zugriffstoken). Eine optionale übergeordnete Seite hält die Protokolle zusammen. Jedes Meeting
wählt dann sein Wiki unter Einstellungen › Integrationen: Bei jeder Archivierung wird das Protokoll zu einer
Seite mit dem Datum der Sitzung und dem Namen des Meetings, mit einem Link zum Verlauf. Eine bearbeitete
Zusammenfassung aktualisiert die Seite; frühere Sitzungen werden aus dem Verlauf veröffentlicht, wo eine
fehlgeschlagene Veröffentlichung ihren Grund nennt und wiederholt werden kann. Beispiel-Meetings
veröffentlichen nichts.

### KI-Assistent und Transkripte

Mit Team entwirft der **KI-Assistent** die Zusammenfassung einer Sitzung und schlägt Folgeaufgaben vor; die
Moderation prüft alles, bevor es gespeichert wird. Er nutzt einen API-Schlüssel von Anthropic: den der
Instanz (`ANTHROPIC_API_KEY`) oder den des Arbeitsbereichs.

**Transkripte** machen aus dem, was in einer Sitzung gesagt wird, Text, nach den Beiträgen der Runde geordnet (was außerhalb der Runde gesagt wird, ist niemandem zugeordnet). Sie brauchen
einen Sprache-zu-Text-Dienst: OpenAI oder einen eigenen Whisper-Server (das Profil `whisper` der
Compose-Datei startet einen auf demselben Rechner). Jedes Meeting muss sie in seinen Einstellungen
erlauben, alle sehen ein Banner, solange eine Sitzung aufgenommen wird, und jede Person kann ihre Beiträge
ausnehmen. Der Ton wird gelöscht, sobald er transkribiert ist.

## Audit-Log

Mit Team listet der Tab **Audit-Log** auf, wer in den letzten 90 Tagen was im Arbeitsbereich geändert hat:
Einstellungen, Personen, Rollen und Meetings, mit CSV-Export. Enterprise behält den gesamten Verlauf und kann
jeden Eintrag signiert an einen Webhook-Connector für dein SIEM oder deine Log-Plattform senden.

## Backups und Updates

Alles, was Ronde speichert, liegt in seiner PostgreSQL-Datenbank. Die
[Anleitung zum Selbsthosten](../self-hosting/README.de.md#backups) erklärt, wie du sie sicherst,
wiederherstellst und auf eine neue Version wechselst.
