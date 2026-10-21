# Amministrare Ronde

Questa guida è per chi gestisce Ronde per un'organizzazione: l'amministratore di un'istanza in self-hosting,
e i proprietari e gli amministratori di uno spazio di lavoro (nel cloud o sul tuo server). Per installare
Ronde, parti dalla [guida al self-hosting](../self-hosting/README.it.md).

## L'istanza

Il primo account creato su una nuova istanza ne diventa l'**amministratore**. Apre
**Amministrazione del server** dal menu dello spazio, in alto a sinistra (`/admin`), dove può:

- vedere quanti account, spazi di lavoro e riunioni contiene l'istanza;
- scegliere la lingua predefinita, usata quando né la persona né il suo browser chiedono una lingua che
  Ronde parla;
- decidere chi può creare un account;
- inserire o rimuovere la chiave di licenza.

I valori salvati in questa pagina hanno la precedenza sulle variabili d'ambiente. Le impostazioni proprie
di ogni spazio (membri, ruoli, sicurezza) restano nelle sue **Impostazioni**.

Nel cloud, il team di Ronde gestisce il server: non c'è Amministrazione del server, chiunque può creare
un account e il piano di ogni spazio viene dal suo abbonamento.

### Chi può creare un account

| Regola | Chi può registrarsi |
| --- | --- |
| Su invito (predefinita) | Solo le persone invitate in uno spazio di lavoro |
| Domini email | Le persone invitate, e chiunque abbia un indirizzo dei domini elencati |
| Aperta | Chiunque raggiunga l'istanza |

La stessa scelta si può fare con `SIGNUP_POLICY` (`invite-only`, `domains`, `open`) e
`SIGNUP_ALLOWED_DOMAINS`.

### Chiave di licenza

Le funzioni di Team ed Enterprise si attivano con una chiave di licenza, inserita in Amministrazione
del server o con la variabile `RONDE_LICENSE` (la variabile prevale e blocca il campo). La chiave viene
verificata sul server, offline: non viene inviato nulla da nessuna parte. La pagina mostra il piano, il
cliente, la data di scadenza e quanti posti sono usati.

- **Un posto** è una persona che ha partecipato a una riunione negli ultimi 30 giorni, come nel cloud di Ronde. Chi è
  stato invitato e non è mai venuto, o è stato assente tutto il mese, non ne occupa nessuno, e una persona presente in più
  spazi di lavoro (con lo stesso account o lo stesso indirizzo) conta una sola volta.
- **Il conteggio più alto** di ogni licenza viene conservato finché la licenza è valida (attiva o nel periodo di
  tolleranza), con un conteggio ogni notte e a ogni visita della pagina. È questo il numero su cui si basa il rinnovo.
  Una nuova chiave avvia un conteggio proprio, e la pagina mostra ancora il conteggio più alto della licenza
  precedente, per regolarla.
- **Più persone che posti**: non si blocca nulla. La pagina lo segnala, e la differenza si regola al rinnovo.
- **Scaduta**: un periodo di tolleranza di 14 giorni mantiene tutto funzionante. Dopo, le funzioni a
  pagamento passano in sola lettura: ciò che contengono resta leggibile, ma non si può aggiungere nulla di
  nuovo. Le funzioni Community non sono mai toccate.
- L'immagine `ronde-ce` è compilata solo dal codice open source e non può leggere una chiave di licenza: usa
  l'immagine `ronde` per Team o Enterprise.

Scuole e università ricevono una licenza Enterprise gratuita: scrivi a hello@joinronde.com dall'indirizzo
del tuo istituto.

### Nascondere i piani a pagamento

Gli amministratori vedono nelle impostazioni discreti suggerimenti sulle funzioni a pagamento (mai durante
una riunione). Imposta `RONDE_HIDE_UPGRADE_HINTS=1` per rimuoverli da tutta l'istanza.

### Feedback degli utenti

Il pulsante a forma di fumetto in alto nelle pagine (nel menu dell'account sul telefono) permette di segnalare un
problema o proporre un'idea, con uno screenshot se lo si desidera. Con il messaggio partono l'indirizzo della pagina
(senza parametri), il browser, la dimensione della finestra, la lingua e la versione di Ronde. Gli amministratori
leggono i messaggi in **Amministrazione del server**, rispondono via email a chi l'ha chiesto e possono aprire una
issue precompilata sul progetto Ronde per un problema di Ronde stesso. Se `SENTRY_DSN` è impostato, i messaggi
arrivano anche a quel progetto Sentry come feedback degli utenti. I messaggi vengono eliminati dopo un anno;
su un'istanza self-hosted il pulsante è disattivato per impostazione predefinita: `RONDE_FEEDBACK=on` lo mostra.

## Spazi di lavoro

Uno spazio di lavoro riunisce le persone, le riunioni, i modelli e i connettori di un team. Chiunque possa
registrarsi può crearne uno; una persona può appartenere a più spazi. Le impostazioni si trovano in
**Impostazioni**, nella barra laterale:

| Scheda | Cosa contiene | Chi la vede |
| --- | --- | --- |
| Generale | Nome, link, lingua, categorie professionali, chi può creare riunioni, connettori e integrazioni | Tutti; proprietari e amministratori la modificano |
| Sicurezza | Domini verificati, provider di identità, LDAP, SCIM | Proprietari e amministratori (Enterprise) |
| Ruoli | Ruoli personalizzati | Proprietari e amministratori (Enterprise) |
| Registro di audit | Chi ha cambiato cosa | Proprietari e amministratori (Team, Enterprise) |
| Fatturazione | Piano e fatture | Proprietari e ruolo Fatturazione, nel cloud |
| Piani | Cosa aggiungono Team ed Enterprise, e dove ottenerli | Proprietari e amministratori, self-hosted |

### Ruoli

Ogni membro ha un ruolo nello spazio di lavoro:

| Ruolo | Può |
| --- | --- |
| Proprietario | Tutto, inclusa la fatturazione e l'eliminazione dello spazio di lavoro |
| Amministratore | Tutto tranne fatturazione ed eliminazione; agisce da conduttore di ogni riunione |
| Fatturazione | Il piano, le fatture e il metodo di pagamento, nient'altro (nel cloud) |
| Organizzatore | Ciò che può un membro, più creare riunioni quando sono riservate agli amministratori, e invitare persone |
| Membro | Vedere la rubrica, creare riunioni (salvo che siano riservate a organizzatori e amministratori), salvare modelli |
| Ospite | Solo le riunioni a cui è invitato |

Ogni persona di una riunione ha anche un ruolo nella riunione:

| Ruolo | Può |
| --- | --- |
| Conduttore | Condurre le sessioni, configurare la riunione, gestirne le persone, modificare il verbale |
| Co-conduttore | Condurre le sessioni e modificare il verbale, senza cambiare impostazioni o persone della riunione |
| Partecipante | Compilare la propria scheda, partecipare alle sessioni, leggere la cronologia |
| Osservatore | Seguire le sessioni e leggere la cronologia |

Chi crea una riunione ne è il conduttore. Con Enterprise, i **ruoli personalizzati** aggiungono permessi a
membri e ospiti; i loro permessi di riunione valgono per tutte le riunioni dello spazio di lavoro.

### Persone e inviti

La **rubrica** è condivisa da tutte le riunioni dello spazio di lavoro: nome, compleanno (solo giorno e
mese), categoria professionale e account GitLab o GitHub di una persona si inseriscono una volta sola. Si
possono aggiungere persone senza account, per una riunione in cui non accedono; invitarle invia un'email
con un link valido 14 giorni. Rimuovere un membro chiude il suo accesso; le sue schede e la sua cronologia
restano nello spazio di lavoro. Con SCIM, le persone disattivate nella tua rubrica aziendale perdono
l'accesso allo stesso modo.

### Assenze

Ogni persona può aggiungere le proprie assenze nel profilo (chi gestisce le persone può farlo per
chiunque): un primo e un ultimo giorno, una nota, e chi conduce nel frattempo le riunioni che organizza.
Durante un'assenza la persona risulta assente alle sessioni di quei giorni, non riceve promemoria, e il suo
profilo mostra quando rientra. La persona indicata come sostituto riceve una notifica e conduce quelle
riunioni come conduttore, solo in quei giorni.

### Margine tra le riunioni

Nella scheda Generale, il **Margine tra due riunioni** (nessuno, 5, 10, 15 o 30 minuti) resta libero prima e
dopo ogni riunione di una persona. «Trova uno slot» lo rispetta, e la pianificazione di una riunione segnala le
date troppo vicine a un'altra riunione delle stesse persone.

## Accesso e accesso unico

L'edizione Community offre account con email e password, link di accesso via email, verifica in due
passaggi, account Google, GitHub e Microsoft, e un provider OpenID Connect per l'istanza (variabili `OIDC_*`,
vedi la [guida al self-hosting](../self-hosting/README.it.md)).

Ogni persona gestisce il proprio modo di accedere dal suo account, in **Accesso e sicurezza**: password, passkey (Face ID, Windows Hello, un gestore di password o una chiave di sicurezza), verifica in due passaggi e disconnessione ovunque. Le passkey sono legate al dominio di `APP_URL`, che deve usare HTTPS: dopo un cambio di dominio, ognuno le aggiunge di nuovo. Un indirizzo che deve usare l'accesso unico non può né aggiungere né usare passkey.

Con Enterprise, la scheda **Sicurezza** di uno spazio di lavoro aggiunge:

1. **Domini verificati.** Aggiungi il tuo dominio email e il record DNS mostrato, poi verificalo. Un dominio
   verificato può:
   - **acquisire i nuovi account**: chi si registra con un indirizzo del dominio entra nello spazio di lavoro
     come membro;
   - **richiedere l'accesso unico**: i suoi indirizzi accedono solo con il tuo provider, senza password né
     link via email. Verifica che il provider funzioni per te prima di attivarlo.
2. **Provider di identità**, OpenID Connect o SAML (Okta, Entra ID, Google Workspace, Keycloak…), per gli
   indirizzi dei tuoi domini verificati. La pagina indica l'URI di reindirizzamento o l'URL di risposta (ACS)
   e l'entity ID da inserire dal lato del provider.
3. **Rubrica aziendale (LDAP o Active Directory).** Le persone accedono con la password della rubrica.
   Ronde le cerca con un account di servizio e verifica la loro password senza conservarla. Usa `ldaps://`,
   oppure `ldap://` con StartTLS.
4. **Provisioning (SCIM).** La tua rubrica (Okta, Entra ID, JumpCloud…) crea le persone, ne aggiorna nome e
   indirizzo e le rimuove quando se ne vanno. La scheda indica l'endpoint SCIM e un token.

Un'istanza dietro un reverse proxy che autentica può invece fidarsi dell'indirizzo che questo trasmette in
un'intestazione (`AUTH_TRUSTED_EMAIL_HEADER`); fallo solo se nient'altro può raggiungere Ronde.

## Riunioni

Proprietari e amministratori possono riservare la creazione di riunioni a organizzatori e amministratori nella scheda
Generale. Ogni riunione ha poi le proprie impostazioni, aperte ai suoi conduttori: pianificazione, persone e
ruoli, sezioni della scheda, ordine del giorno, moduli, aspetto, notifiche, videochiamata e integrazioni.
Una riunione può essere salvata come modello dello spazio di lavoro, senza le sue persone, la sua
cronologia o i suoi token.

Una riunione parte con l'emoji del suo modello, mostrato accanto al nome nei menu; in Impostazioni › Aspetto, chi la conduce sceglie un altro emoji o carica un'immagine (un logo, una foto del team).

### Sessioni al momento

**Inizia ora**, sulla scheda di una riunione, tiene subito una sessione, fuori calendario: il team viene
avvisato (campanella e regole di notifica «sessione iniziata») e si apre la regia. La sessione porta la
data di oggi; la data prevista resta nella pianificazione. Avviare dalla regia una sessione preparata per un
altro giorno fa lo stesso.

### Riunione di esempio

Prima della prima riunione, la home di uno spazio propone una riunione di esempio: una riunione settimanale con un team fittizio di cinque persone, un mese di sessioni archiviate con verbali, statistiche e azioni, e una sessione pronta da avviare, tutto nella lingua dello spazio. Serve a provare tutto: non invia nulla (né promemoria, né email, né eventi di calendario, né notifiche), non conta come posto, non spunta nessuno dei primi passi e resta fuori dalle analisi e dai report dello spazio. Un banner sulle sue pagine lo ricorda, e **Elimina l'esempio** la cancella definitivamente insieme al team fittizio (una persona di quel team aggiunta a un'altra riunione resta). Le sue persone compaiono come Esempio nella rubrica e non possono essere invitate.

### Festività

Nella scheda Generale, uno spazio sceglie le festività di un paese, e di una regione quando differiscono (un Land tedesco, una comunità spagnola…); un nuovo spazio parte da quelle del paese del suo fuso orario. Una sessione che cade in uno di quei giorni viene saltata: viene preparata la data successiva, promemoria e calendari seguono, e la pianificazione nomina la festività. Nella sua pianificazione, una riunione può seguire altre festività o nessuna, e chi la conduce può comunque mantenere o spostare ogni sessione saltata. Le festività vengono dal progetto date-holidays, basato su Wikipedia (CC BY-SA 3.0).

### Link ospite

Nelle impostazioni di una riunione, **Persone › Link ospite** crea un link segreto per persone senza
account (un cliente, un consiglio, un partner). Apre lo schermo condiviso, in diretta e in sola lettura,
finché non scade (da 1 a 90 giorni) o un conduttore lo revoca. Il link viene mostrato una sola volta, alla
creazione; Ronde ne conserva solo l'hash.

### Progetti e portafoglio

La pagina **Progetti** di uno spazio contiene il suo portafoglio: ogni progetto, tema o cantiere, con un
riassunto di una riga, una descrizione, un tema, una situazione, uno stato (va bene, a rischio, in
difficoltà), un responsabile, le persone che ci lavorano, date e link. I membri possono creare progetti; il
responsabile e gli amministratori li modificano. La pagina di un progetto raccoglie quello che ogni
riunione ne ha detto, sessione dopo sessione, per le persone che possono leggere quelle riunioni.

Ogni progetto può avere un logo, accanto al nome e nella sua fase delle riunioni: clicca sul suo segno, nella pagina del progetto, per scegliere un'immagine; senza logo, compaiono le sue iniziali sul suo colore. Un'importazione riprende l'immagine dello strumento: l'avatar di un'organizzazione GitHub, quello di un progetto GitLab o di un progetto Jira. Chi può modificare il progetto lo cambia o lo rimuove.

Una riunione segue dei progetti in **Impostazioni › Progetti**. Ogni progetto seguito ha una sezione propria
nella scheda di ciascuno, con una scheda condivisa: lo stato e il messaggio del giorno, scritti da chi ci
lavora. Aggiungi il blocco **Giro per progetto** all'ordine del giorno per dare a ogni progetto il suo
turno, in cui i suoi membri parlano insieme; senza, gli elementi su un progetto sono presentati nel turno di
ciascuno. I modelli **Revisione del portafoglio** e **Team e progetti** lo includono già. Con Team, una
dashboard mostra lo stato di ogni progetto settimana dopo settimana, le scadenze e i progetti senza
notizie, lo esporta in CSV e aggiunge i progetti da tenere d'occhio al report via email. Con Enterprise, un progetto può far parte di un altro, che diventa un programma (al massimo tre livelli), essere visibile solo ai suoi membri e modificabile dai suoi membri, non solo dal responsabile.

**Importa**, nella stessa pagina, porta progetti dai tuoi strumenti: i repository di un'organizzazione GitHub o i progetti di un gruppo GitLab, le milestone di un repository GitHub o di un progetto GitLab (ognuna chiamata «repository · milestone»), le epic di un progetto Jira o i progetti di Linear. Spunta quelli da portare; quelli già nel portafoglio vengono riconosciuti, e ogni elemento entra una sola volta. Il token inserito lì serve solo a quell'importazione e non viene conservato:

- GitHub: nessuno per i repository pubblici; per quelli privati, un token a grana fine che possa leggerli (Metadata, e Issues per le milestone).
- GitLab: nessuno per gruppi e progetti pubblici; altrimenti un token di accesso personale, di gruppo o di progetto con lo scope `read_api`.
- Jira: un token API dell'account la cui email è indicata (id.atlassian.com › Sicurezza › Token API).
- Linear: una chiave API personale.

I membri importano da github.com, gitlab.com, Atlassian Cloud e Linear; importare da un altro server (GitHub Enterprise, un GitLab self-managed, Jira Data Center) e tramite i sistemi di ticketing salvati nelle impostazioni dello spazio è riservato agli amministratori dello spazio. Con Team, importare tramite uno di questi sistemi mantiene i progetti sincronizzati ogni ora: nome, situazione, date e avanzamento seguono lo strumento, ciò che lo strumento non fornisce resta com'è impostato in Ronde (un repository dà il suo nome e passa a «Concluso» una volta archiviato), e l'avanzamento compare sulle card del portafoglio e nelle riunioni finché è aggiornato. La pagina del progetto offre **Aggiorna ora** e **Interrompi la sincronizzazione**. La sincronizzazione si ferma definitivamente con **Interrompi la sincronizzazione**, quando il sistema di ticketing viene rimosso o punta a un altro server, e si sospende finché lo spazio non è su Team. Un elemento che lo strumento non trova più (eliminato, o fuori dalla portata del token) viene ritentato una volta al giorno. I progetti archiviati non vengono aggiornati finché non vengono ripristinati.

### Moduli

Tutti i moduli di facilitazione sono gratuiti: rompighiaccio, umore del team, voto di utilità, reazioni, mani alzate,
ringraziamenti, in evidenza, ruota ed estrazioni, compleanni, suoni, timebox, sondaggi, parcheggio, registro
delle decisioni, retrospettiva, planning poker e riunioni asincrone. Un modulo disattivato in una riunione
scompare dalla sua regia, dal suo schermo condiviso e dalle schede; le sue impostazioni restano salvate.

Il voto di utilità chiede a tutti, in chiusura, quanto è stata utile la riunione (da 1 a 5 stelle, dal proprio schermo o telefono). La media compare da 3 voti in su, così nessuno può indovinare il voto di un altro; finisce nel verbale e nelle statistiche. I modelli delle riunioni quotidiane brevi, dei colloqui individuali e degli organi formali (comitato di indirizzo, consigli, consiglio di classe, riunione di cantiere, riunione multidisciplinare, revisione degli incidenti) lo lasciano disattivato.

### Esportazioni

Le pagine che elencano qualcosa lo esportano per un foglio di calcolo: **Esporta in CSV** nella pagina
Azioni (tutte le azioni della vista, anche quelle fatte più di due settimane fa), nella pagina Decisioni
(con la ricerca e il filtro per riunione), nelle Statistiche di una riunione (una riga per sessione) e,
con Team, nella tabella delle Analisi e nella dashboard del portafoglio. I verbali si scaricano in Markdown
o PDF dalla Cronologia. I file si aprono subito in colonne in Excel, LibreOffice o Numbers, nella lingua
della persona («;» e virgola decimale in francese, tedesco, spagnolo, italiano, portoghese e russo), e un
testo che sembra una formula resta testo.

## Notifiche

I **connettori** sono i canali in cui le riunioni possono pubblicare: email, Matrix (Tchap), Slack,
Microsoft Teams, Discord, Mattermost, oppure un webhook firmato con HMAC. Proprietari e amministratori li
aggiungono nella scheda Generale dello spazio di lavoro. Ogni riunione sceglie poi, nelle impostazioni delle
notifiche, quali eventi vanno a quale connettore: una sessione che sta per iniziare, iniziata o conclusa, un
verbale pubblicato, un promemoria della scheda, un'azione in ritardo, un compleanno.

Ogni lunedì dalle 8:00 (fuso orario dello spazio), ogni membro riceve un **riepilogo settimanale** via email:
le sue sessioni della settimana con un link a ogni scheda, le azioni di follow-up aperte e i ringraziamenti
ricevuti. Viene inviato solo se contiene qualcosa; ognuno lo disattiva nel proprio account o con il link in
fondo all'email. Su un'istanza self-hosted serve `SMTP_URL`; `RONDE_WEEKLY_PER_RUN` (150 per impostazione predefinita) limita
gli invii per ora, gli altri partono l'ora successiva.

Con Team, i workflow di notifica aggiungono condizioni e le tue parole a ogni messaggio, e altri due
connettori inviano **SMS** e messaggi **WhatsApp** tramite Twilio: inserisci l'Account SID, il numero mittente
e l'auth token. I messaggi vanno ai numeri di cellulare che le persone indicano nel profilo (formato
internazionale, +39…), mai alle persone assenti. Per WhatsApp, il mittente deve essere approvato in Twilio, e
WhatsApp permette a un'azienda di scrivere per prima solo con un modello approvato da Meta: creane uno nel
Content Template Builder di Twilio con due variabili (il messaggio, poi il link) e inserisci il suo Content
SID nel connettore. Quando uno spazio di lavoro lascia Team, questi messaggi si fermano e il registro di ogni
riunione dice perché.

**Scheda via email**: quando l'istanza legge una casella (`INBOUND_IMAP_URL`, vedi la guida al self-hosting), il promemoria dice che basta rispondere. Il nome di ogni sezione su una riga, i punti sotto: le righe vengono aggiunte alla scheda della persona (senza sostituire nulla) e un'email conferma cosa è stato aggiunto. Contano solo le risposte dall'indirizzo del promemoria (o da quello dell'account della persona), per 14 giorni; osservatori e riunione di esempio sono esclusi.

**Notifiche push**: quando l'istanza ha le sue chiavi (vedi la guida al self-hosting), ognuno può installare Ronde dal browser (o aggiungerlo alla schermata Home di un iPhone) e, nel proprio account, attivare le notifiche dispositivo per dispositivo: il proprio turno che si avvicina durante una sessione dal vivo, i promemoria della scheda e ciò che arriva nella campanella. Ogni tipo si può disattivare, e i dispositivi sono elencati lì.

## Integrazioni

Token e segreti inseriti in Ronde vengono cifrati con `SECRET_KEY` prima di essere salvati, e non vengono
più mostrati. Custodisci bene questa chiave: senza di essa non si possono più rileggere.

Anche i token degli account che accedono con Google, GitHub, Microsoft o l'accesso unico vengono cifrati, con `AUTH_SECRET`.

| Integrazione | Dove | Piano |
| --- | --- | --- |
| GitLab e GitHub: importare issue e merge request nelle schede | Impostazioni della riunione | Community |
| Videochiamata: qualsiasi link, Jitsi, BigBlueButton | Impostazioni della riunione | Community |
| Stanze Zoom, Google Meet e Teams create per ogni riunione | Spazio di lavoro, Generale | Team |
| Calendari Google, Outlook e CalDAV (iCloud, Fastmail, Nextcloud…), nei due sensi: sessioni scritte nei calendari dei partecipanti, spostamenti, eliminazioni e risposte fatti lì ripresi, disponibilità lette | Spazio di lavoro, Generale | Team |
| Ticket Jira, Linear, GitLab e GitHub dalle azioni di follow-up, chiusi insieme | Spazio di lavoro, Generale | Team |
| GitHub, GitLab, Jira e Linear: repository, milestone, epic e progetti importati nel portafoglio | Progetti › Importa | Community |
| Progetti importati sincronizzati con il loro strumento: nome, situazione, date e avanzamento | Progetti › Importa, tramite un sistema di ticketing | Team |
| Il tuo logo sullo schermo condiviso, nelle email e nei verbali | Spazio di lavoro, Generale | Team |
| App Slack: promemoria in messaggio diretto, schede compilate da Slack, `/ronde`, un canale per le notifiche | Spazio di lavoro, Generale | Team |
| App Microsoft Teams: promemoria con messaggio personale, schede compilate da Teams, `ronde`, un canale per le notifiche | Spazio di lavoro, Generale | Team |
| Notion e Confluence: il verbale di ogni sessione pubblicato come pagina, aggiornato con il riepilogo | Spazio di lavoro, Generale, poi Impostazioni della riunione › Integrazioni | Team |

### Slack

Con Team, proprietari e amministratori fanno clic su **Aggiungi a Slack** nella scheda Generale e scelgono
il canale delle notifiche. Poi:

- i promemoria della scheda arrivano in messaggio diretto, con un pulsante **Compila la mia scheda** che
  apre le sezioni della riunione in un modulo Slack; le risposte vengono salvate in Ronde come se fossero
  state scritte nella pagina;
- il canale scelto diventa un connettore, pronto per le regole di notifica delle riunioni (verbale
  pubblicato, sessione in arrivo…);
- `/ronde` mostra a ciascuno le prossime sessioni e le azioni di follow-up aperte, visibili solo a lui.

Le persone sono riconosciute dalla loro email: l'account Slack e il profilo Ronde devono avere la stessa.
Chi non viene trovato in Slack continua a ricevere il promemoria via email. **Disconnetti** rimuove l'app
da Slack ed elimina le regole di notifica che pubblicano nel suo canale. Su un'istanza self-hosted,
l'amministratore crea prima l'app Slack dell'istanza (vedi la guida al self-hosting).

### Microsoft Teams

Un proprietario o un amministratore scarica l'app Ronde per Teams dalla scheda Generale; un amministratore di
Teams la carica nelle app dell'organizzazione e la aggiunge a un team. Nel suo canale, Ronde pubblica una card:
**Collega a Ronde** apre Ronde, dove si sceglie lo spazio. Da quel momento, i promemoria della scheda partono
con un messaggio personale alle persone trovate nel team (riconosciute dalla loro email), con un pulsante che
trasforma il messaggio nel modulo della scheda; scrivere «ronde» all'app elenca le prossime sessioni e le azioni
aperte della persona; e il canale diventa un connettore per le regole di notifica delle riunioni. Rimuovere
l'app dal team, o **Scollega** in Ronde, ferma tutto, e i promemoria tornano via email.

### Notion e Confluence

Proprietari e amministratori aggiungono un wiki nella scheda Generale: una pagina **Notion** condivisa con
un'integrazione interna (creata su notion.so/profile/integrations; condividi la pagina con essa da
••• › Connessioni), oppure uno spazio **Confluence**, nel cloud (sito, chiave dello spazio, email
dell'account e un token API di id.atlassian.com) o su un Data Center o Server (un token di accesso
personale). Una pagina principale facoltativa raccoglie i verbali. Poi ogni riunione sceglie il suo wiki in
Impostazioni › Integrazioni: a ogni pubblicazione, il verbale diventa una pagina con la data della sessione
e il nome della riunione, con un link alla cronologia. Modificare il riepilogo aggiorna la pagina; le
sessioni precedenti si pubblicano dalla cronologia, dove una pubblicazione non riuscita spiega il motivo e
può essere ripetuta. Le riunioni di esempio non pubblicano nulla.

### Assistente IA e trascrizioni

Con Team, l'**assistente IA** scrive la sintesi di una sessione e propone azioni di follow-up; il conduttore
rivede tutto prima del salvataggio. Usa una chiave API di Anthropic: quella dell'istanza
(`ANTHROPIC_API_KEY`) o quella dello spazio di lavoro.

Le **trascrizioni** trasformano in testo ciò che si dice durante una sessione, ordinato per turno del giro di tavolo (ciò che si dice fuori dal giro non è attribuito a nessuno). Richiedono
un servizio di trascrizione: OpenAI, oppure un tuo server Whisper (il profilo `whisper` del file Compose ne
avvia uno sulla stessa macchina). Ogni riunione deve consentirle nelle sue impostazioni, tutti vedono un
banner mentre una sessione è registrata, e ogni persona può escludere i propri turni. L'audio viene
eliminato appena trascritto.

## Registro di audit

Con Team, la scheda **Registro di audit** elenca chi ha cambiato cosa nello spazio di lavoro negli ultimi 90
giorni: impostazioni, persone, ruoli e riunioni, con esportazione CSV. Enterprise conserva tutta la cronologia
e può inviare ogni voce, firmata, a un connettore webhook per il tuo SIEM o la tua piattaforma di log.

## Backup e aggiornamenti

Tutto ciò che Ronde conserva si trova nel suo database PostgreSQL. La
[guida al self-hosting](../self-hosting/README.it.md#backups) spiega come farne il backup, ripristinarlo e
passare a una nuova versione.
