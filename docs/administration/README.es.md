# Administrar Ronde

Esta guía es para las personas que gestionan Ronde para una organización: la administradora de una
instancia autoalojada, y los propietarios y administradores de un espacio de trabajo (en la nube o en tu
propio servidor). Para instalar Ronde, empieza por la [guía de autoalojamiento](../self-hosting/README.es.md).

## La instancia

La primera cuenta creada en una instancia nueva se convierte en su **administradora**. Abre
**Administración del servidor** desde el menú del espacio, arriba a la izquierda (`/admin`), donde puede:

- ver cuántas cuentas, espacios de trabajo y reuniones contiene la instancia;
- elegir el idioma por defecto, que se usa cuando ni la persona ni su navegador piden un idioma que Ronde
  habla;
- decidir quién puede crear una cuenta;
- introducir o quitar la clave de licencia.

Los valores guardados en esta página prevalecen sobre las variables de entorno. Los ajustes propios de cada
espacio (miembros, roles, seguridad) siguen en sus **Ajustes**.

En la nube, el equipo de Ronde gestiona el servidor: no hay Administración del servidor, cualquiera
puede crear una cuenta y el plan de cada espacio viene de su suscripción.

### Quién puede crear una cuenta

| Política | Quién puede registrarse |
| --- | --- |
| Por invitación (por defecto) | Solo las personas invitadas a un espacio de trabajo |
| Dominios de correo | Las personas invitadas, y cualquiera con una dirección de los dominios indicados |
| Abierta | Cualquiera que llegue a la instancia |

La misma elección puede hacerse con `SIGNUP_POLICY` (`invite-only`, `domains`, `open`) y
`SIGNUP_ALLOWED_DOMAINS`.

### Clave de licencia

Las funciones de Team y Enterprise se activan con una clave de licencia, introducida en Administración del
servidor o con la variable `RONDE_LICENSE` (la variable tiene prioridad y bloquea el campo). La clave se
comprueba en el servidor, sin conexión: no se envía nada a ninguna parte. La página muestra el plan, el
cliente, la fecha de caducidad y cuántas plazas se usan.

- **Más personas que plazas**: no se bloquea nada; la página te pide que actualices la licencia.
- **Caducada**: un periodo de gracia de 14 días lo mantiene todo en marcha. Después, las funciones de pago
  pasan a solo lectura: lo que contienen sigue siendo legible, pero no se puede añadir nada nuevo. Las
  funciones de Community nunca se ven afectadas.
- La imagen `ronde-ce` se compila solo con el código abierto y no puede leer una clave de licencia: usa la
  imagen `ronde` para Team o Enterprise.

Los centros educativos y las universidades reciben una licencia Enterprise gratuita: escribe a
hello@joinronde.com desde la dirección de tu institución.

### Ocultar los planes de pago

Los administradores ven en los ajustes discretas sugerencias sobre las funciones de pago (nunca durante una
reunión). Define `RONDE_HIDE_UPGRADE_HINTS=1` para quitarlas de toda la instancia.

### Comentarios de los usuarios

El botón con forma de bocadillo en la parte superior de las páginas (en el menú de la cuenta en el móvil) permite
informar de un problema o proponer una idea, con una captura de pantalla si se quiere. Con el mensaje se envían la
dirección de la página (sin sus parámetros), el navegador, el tamaño de la ventana, el idioma y la versión de Ronde.
Los administradores leen los mensajes en **Administración del servidor**, responden por correo a quien lo pidió y
pueden abrir un issue prerrellenado en el proyecto Ronde para un problema del propio Ronde. Si `SENTRY_DSN` está
definido, los mensajes también llegan a ese proyecto de Sentry como comentarios de usuarios. Los mensajes se
eliminan al cabo de un año; `RONDE_FEEDBACK=off` quita el botón.

## Espacios de trabajo

Un espacio de trabajo reúne a las personas, las reuniones, las plantillas y los conectores de un equipo.
Cualquiera que pueda registrarse puede crear uno; una persona puede pertenecer a varios. Sus ajustes están
en **Ajustes**, en la barra lateral:

| Pestaña | Qué contiene | Quién la ve |
| --- | --- | --- |
| General | Nombre, enlace, idioma, categorías profesionales, quién puede crear reuniones, conectores e integraciones | Todos; propietarios y administradores la modifican |
| Seguridad | Dominios verificados, proveedores de identidad, LDAP, SCIM | Propietarios y administradores (Enterprise) |
| Roles | Roles personalizados | Propietarios y administradores (Enterprise) |
| Registro de auditoría | Quién cambió qué | Propietarios y administradores (Team, Enterprise) |
| Facturación | Plan y facturas | Propietarios y rol Facturación, en la nube |
| Planes | Lo que añaden Team y Enterprise, y dónde conseguirlos | Propietarios y administradores, autoalojado |

### Roles

Cada miembro tiene un rol en el espacio de trabajo:

| Rol | Puede |
| --- | --- |
| Propietario | Todo, incluida la facturación y la eliminación del espacio de trabajo |
| Administrador | Todo salvo la facturación y la eliminación; actúa como anfitrión de todas las reuniones |
| Facturación | El plan, las facturas y el método de pago, nada más (en la nube) |
| Organizador | Lo que puede un miembro, además de crear reuniones cuando están reservadas a los administradores, e invitar a personas |
| Miembro | Ver el directorio, crear reuniones (salvo que estén reservadas a organizadores y administradores), guardar plantillas |
| Invitado | Solo las reuniones a las que se le invita |

Cada persona de una reunión tiene además un rol en esa reunión:

| Rol | Puede |
| --- | --- |
| Anfitrión | Dirigir las sesiones, configurar la reunión, gestionar sus personas, editar las actas |
| Coanfitrión | Dirigir las sesiones y editar las actas, sin cambiar los ajustes ni las personas de la reunión |
| Participante | Rellenar su ficha, participar en las sesiones, leer el historial |
| Observador | Seguir las sesiones y leer el historial |

Quien crea una reunión es su anfitrión. Con Enterprise, los **roles personalizados** añaden permisos a
miembros e invitados; sus permisos de reunión se aplican a todas las reuniones del espacio de trabajo.

### Personas e invitaciones

El **directorio** lo comparten todas las reuniones del espacio de trabajo: el nombre de una persona, su
cumpleaños (solo día y mes), su categoría profesional y sus cuentas de GitLab o GitHub se introducen una
sola vez. Se pueden añadir personas sin cuenta, para una reunión en la que no inician sesión; invitarlas
envía un correo con un enlace válido durante 14 días. Quitar a un miembro pone fin a su acceso; sus fichas y
su historial se quedan en el espacio de trabajo. Con SCIM, las personas desactivadas en tu directorio
pierden el acceso de la misma manera.

### Ausencias

Cada persona puede añadir sus ausencias en su perfil (quienes gestionan personas pueden hacerlo para
cualquiera): un primer y un último día, una nota, y quién dirige mientras tanto las reuniones que organiza.
Durante una ausencia, la persona figura como ausente en las sesiones de esos días, no recibe recordatorios,
y su perfil muestra cuándo vuelve. La persona designada como sustituta recibe una notificación y dirige esas
reuniones como anfitriona, solo durante esos días.

### Margen entre reuniones

En la pestaña General, **Margen entre dos reuniones** (ninguno, 5, 10, 15 o 30 minutos) se deja libre antes y
después de cada reunión de una persona. «Encontrar un hueco» lo respeta, y el calendario de una reunión
señala las fechas que quedan demasiado cerca de otra reunión de las mismas personas.

## Inicio de sesión e inicio de sesión único

La edición Community ofrece cuentas con correo y contraseña, enlaces de inicio de sesión por correo,
autenticación en dos pasos, cuentas de Google, GitHub y Microsoft, y un proveedor OpenID Connect para la
instancia (variables `OIDC_*`, consulta la [guía de autoalojamiento](../self-hosting/README.es.md)).

Cada persona gestiona cómo inicia sesión desde su cuenta, en **Inicio de sesión y seguridad**: contraseña, llaves de acceso (Face ID, Windows Hello, un gestor de contraseñas o una llave de seguridad), verificación en dos pasos y cierre de sesión en todas partes. Las llaves de acceso están ligadas al dominio de `APP_URL`, que debe usar HTTPS: tras un cambio de dominio, cada uno vuelve a añadirlas. Una dirección que debe usar el inicio de sesión único no puede añadir ni usar llaves de acceso.

Con Enterprise, la pestaña **Seguridad** de un espacio de trabajo añade:

1. **Dominios verificados.** Añade tu dominio de correo y el registro DNS que se muestra, y verifícalo. Un
   dominio verificado puede:
   - **captar las cuentas nuevas**: quien se registre con una dirección del dominio se une al espacio de
     trabajo como miembro;
   - **exigir el inicio de sesión único**: sus direcciones inician sesión solo con tu proveedor, sin
     contraseña ni enlace por correo. Comprueba que el proveedor te funciona antes de activarlo.
2. **Proveedores de identidad**, OpenID Connect o SAML (Okta, Entra ID, Google Workspace, Keycloak…), para
   las direcciones de tus dominios verificados. La página da la URI de redirección o la URL de respuesta
   (ACS) y el entity ID que hay que introducir en el lado del proveedor.
3. **Directorio de la empresa (LDAP o Active Directory).** Las personas inician sesión con la contraseña de
   su directorio. Ronde las busca con una cuenta de servicio y comprueba su contraseña sin guardarla. Usa
   `ldaps://`, o `ldap://` con StartTLS.
4. **Aprovisionamiento (SCIM).** Tu directorio (Okta, Entra ID, JumpCloud…) crea a las personas, mantiene al
   día su nombre y su dirección, y las quita cuando se van. La pestaña da el endpoint SCIM y un token.

Una instancia detrás de un proxy inverso que autentica puede fiarse en su lugar de la dirección que este
transmite en una cabecera (`AUTH_TRUSTED_EMAIL_HEADER`); hazlo solo si nada más puede llegar a Ronde.

## Reuniones

Los propietarios y administradores pueden reservar la creación de reuniones a organizadores y administradores en la
pestaña General. Después, cada reunión tiene sus propios ajustes, abiertos a sus anfitriones: calendario,
personas y roles, secciones de la ficha, orden del día, módulos, apariencia, notificaciones, videollamada e
integraciones. Una reunión puede guardarse como plantilla del espacio de trabajo, sin sus personas, su
historial ni sus tokens.

Una reunión empieza con el emoji de su plantilla, que aparece junto a su nombre en los menús; en Ajustes › Apariencia, sus anfitriones eligen otro emoji o suben una imagen (un logotipo, una foto del equipo).

### Sesiones sobre la marcha

**Empezar ahora**, en la tarjeta de una reunión, celebra una sesión de inmediato, fuera del calendario: se
avisa al equipo (campana y reglas de notificación «sesión iniciada») y se abre la sala de control. La sesión
lleva la fecha de hoy; la fecha prevista sigue en el calendario. Empezar desde la sala de control una sesión
preparada para otro día hace lo mismo.

### Reunión de ejemplo

Antes de su primera reunión, el inicio de un espacio ofrece una reunión de ejemplo: una reunión semanal con un equipo ficticio de cinco personas, un mes de sesiones archivadas con sus actas, estadísticas y acciones, y una sesión lista para empezar, todo en el idioma del espacio. Sirve para probarlo todo: no envía nada (ni recordatorios, ni correos, ni eventos de calendario, ni notificaciones), no cuenta como plaza, no marca ninguno de los primeros pasos y queda fuera de los análisis e informes del espacio. Un aviso en sus páginas lo indica, y **Eliminar el ejemplo** lo borra para siempre con su equipo ficticio (una persona de ese equipo añadida a otra reunión se conserva). Sus personas aparecen como Ejemplo en el directorio y no se pueden invitar.

### Festivos

En la pestaña General, un espacio elige los festivos de un país, y de una región cuando difieren (un estado alemán, una comunidad autónoma…); un espacio nuevo parte de los del país de su zona horaria. Una sesión que cae en uno de esos días se salta: se prepara la fecha siguiente, los recordatorios y los calendarios la siguen, y el calendario nombra el festivo. En su calendario, una reunión puede seguir otros festivos o ninguno, y su anfitrión puede mantener o mover cada sesión saltada. Los festivos vienen del proyecto date-holidays, según Wikipedia (CC BY-SA 3.0).

### Enlaces de invitado

En los ajustes de una reunión, **Personas › Enlaces de invitado** crea un enlace secreto para personas sin
cuenta (un cliente, un consejo, un socio). Abre la pantalla compartida, en directo y en solo lectura, hasta
que caduca (de 1 a 90 días) o un anfitrión lo revoca. El enlace se muestra una sola vez, al crearlo; Ronde
solo guarda su hash.

### Proyectos y cartera

La página **Proyectos** de un espacio contiene su cartera: cada proyecto, tema o línea de trabajo, con un
resumen de una línea, una descripción, un tema, una situación, un estado (va bien, en riesgo, en
dificultades), un responsable, las personas que trabajan en él, fechas y enlaces. Los miembros pueden crear
proyectos; su responsable y los administradores los editan. La página de un proyecto reúne lo que cada
reunión dijo de él, sesión tras sesión, para las personas que pueden leer esas reuniones.

Cada proyecto puede tener un logo, junto a su nombre y en su paso de las reuniones: haz clic en su marca, en la página del proyecto, para elegir una imagen; sin logo, se muestran sus iniciales sobre su color. Una importación trae la imagen de la herramienta: el avatar de una organización de GitHub, el de un proyecto de GitLab o el de un proyecto de Jira. Quienes pueden editar el proyecto lo cambian o lo quitan.

Una reunión sigue proyectos en **Ajustes › Proyectos**. Cada proyecto seguido tiene una pestaña en la ficha
de cada persona, con una ficha compartida: el estado y el mensaje del día, redactados por quienes trabajan
en él. Añade el bloque **Ronda por proyecto** al orden del día para dar a cada proyecto su propio turno,
donde sus miembros hablan juntos; sin él, los elementos sobre un proyecto se presentan en el turno de cada
persona. Las plantillas **Revisión de cartera** y **Equipo y proyectos** lo incluyen desde el principio.
Con Team, un panel muestra el estado de cada proyecto semana tras semana, las fechas límite y los proyectos
sin noticias, lo exporta en CSV y añade los proyectos a vigilar al informe por correo. Con Enterprise, un proyecto puede formar parte de otro, que pasa a ser un programa (tres niveles como máximo), ser visible solo para sus miembros y poder ser editado por sus miembros, no solo por su responsable.

**Importar**, en la misma página, trae proyectos de tus herramientas: los repositorios de una organización de GitHub o los proyectos de un grupo de GitLab, los hitos de un repositorio de GitHub o de un proyecto de GitLab (cada uno llamado «repositorio · hito»), las épicas de un proyecto de Jira o los proyectos de Linear. Marca los que quieras traer; los que ya están en la cartera se reconocen, y cada elemento entra una sola vez. El token escrito ahí solo sirve para esa importación y no se guarda:

- GitHub: ninguno para repositorios públicos; para los privados, un token de acceso detallado que pueda leerlos (Metadata, y además Issues para los hitos).
- GitLab: ninguno para grupos y proyectos públicos; si no, un token de acceso personal, de grupo o de proyecto con el ámbito `read_api`.
- Jira: un token de API de la cuenta cuyo correo se indica (id.atlassian.com › Seguridad › Tokens de API).
- Linear: una clave de API personal.

Los miembros importan desde github.com, gitlab.com, Atlassian Cloud y Linear; importar desde otro servidor (GitHub Enterprise, un GitLab autogestionado, Jira Data Center) y mediante los gestores de tickets guardados en los ajustes del espacio queda reservado a los administradores del espacio. Con Team, importar mediante uno de esos gestores mantiene los proyectos sincronizados cada hora: su nombre, situación, fechas y avance siguen a la herramienta, lo que la herramienta no da se queda como está en Ronde (un repositorio da su nombre y pasa a «Terminado» una vez archivado), y su avance se muestra en las tarjetas y en las reuniones mientras está al día. La página del proyecto ofrece **Actualizar ahora** y **Dejar de sincronizar**. La sincronización se detiene definitivamente con **Dejar de sincronizar**, cuando el gestor de tickets se elimina o apunta a otro servidor, y se pausa mientras el espacio no está en Team. Un elemento que la herramienta ya no encuentra (eliminado, o fuera del alcance del token) se vuelve a intentar una vez al día. Los proyectos archivados no se actualizan hasta que se restauran.

### Módulos

Todos los módulos de dinamización son gratis: rompehielos, ánimo del equipo, valoración de utilidad, reacciones, manos levantadas,
agradecimientos, foco, ruleta y sorteos, cumpleaños, sonidos, timebox, encuestas, aparcamiento, registro de
decisiones, retrospectiva, planning poker y reuniones asíncronas. Un módulo desactivado en una reunión
desaparece de su sala de control, de su pantalla compartida y de las fichas; sus ajustes se conservan.

La valoración de utilidad pregunta a todos, en el cierre, si la reunión fue útil (de 1 a 5 estrellas, desde su pantalla o su móvil). La media aparece a partir de 3 valoraciones, para que nadie pueda adivinar la de otra persona; pasa al acta y a las estadísticas. Las plantillas de reuniones diarias cortas, reuniones uno a uno y órganos formales (comité de dirección, juntas, junta de evaluación, reunión de obra, sesión clínica, revisión de incidentes) la dejan desactivada.

### Exportaciones

Las páginas que listan algo lo exportan para una hoja de cálculo: **Exportar en CSV** en la página
Acciones (todas las acciones de la vista, también las hechas hace más de dos semanas), la página Decisiones
(con su búsqueda y su filtro por reunión), las Estadísticas de una reunión (una línea por sesión) y, con
Team, la tabla de Análisis y el Panel del portafolio. Las actas se descargan en Markdown o PDF desde el
Historial. Los archivos se abren directamente en columnas en Excel, LibreOffice o Numbers, en el idioma de
la persona («;» y coma decimal en francés, alemán, español, italiano, portugués y ruso), y un texto que
parece una fórmula sigue siendo texto.

## Notificaciones

Los **conectores** son los canales donde las reuniones pueden publicar: correo, Matrix (Tchap), Slack,
Microsoft Teams, Discord, Mattermost, o un webhook firmado con HMAC. Los propietarios y administradores los
añaden en la pestaña General del espacio de trabajo. Después, cada reunión elige en sus ajustes de
notificaciones qué eventos van a qué conector: una sesión que empieza pronto, iniciada o terminada, actas
publicadas, un recordatorio de ficha, una acción atrasada, un cumpleaños.

Cada lunes a partir de las 8:00 (zona horaria del espacio), cada miembro recibe un **resumen semanal** por
correo: sus sesiones de la semana con un enlace a cada ficha, sus acciones de seguimiento abiertas y los
reconocimientos recibidos. Solo se envía si contiene algo; cada persona lo desactiva en su cuenta o con el
enlace al pie del correo. En una instancia autoalojada necesita `SMTP_URL`; `RONDE_WEEKLY_PER_RUN` (150 por
defecto) limita los envíos por hora y el resto sale a la hora siguiente.

Con Team, el constructor de flujos añade condiciones y tus propias palabras a cada mensaje, y dos conectores
más envían **SMS** y mensajes de **WhatsApp** a través de Twilio: introduce el Account SID, el número
remitente y el auth token. Los mensajes van a los números de móvil que las personas introducen en su perfil
(formato internacional, +34…), y nunca a las personas ausentes. Para WhatsApp, el remitente debe estar
aprobado en Twilio; fuera de una conversación iniciada por la persona, WhatsApp puede exigir una plantilla de
mensaje aprobada.

**Ficha por correo**: cuando la instancia lee un buzón (`INBOUND_IMAP_URL`, ver la guía de autoalojamiento), el recordatorio indica que basta con responder. El nombre de cada sección en una línea y los puntos debajo: las líneas se añaden a la ficha de la persona (sin reemplazar nada) y un correo confirma lo añadido. Solo cuentan las respuestas desde la dirección del recordatorio (o la de la cuenta de la persona), durante 14 días; los observadores y la reunión de ejemplo quedan fuera.

**Notificaciones push**: cuando la instancia tiene sus claves (ver la guía de autoalojamiento), cada persona puede instalar Ronde desde su navegador (o añadirlo a la pantalla de inicio de un iPhone) y, en su cuenta, activar las notificaciones en cada dispositivo: su turno que se acerca durante una sesión en directo, los recordatorios de ficha y lo que llega a la campana. Cada tipo se puede desactivar y los dispositivos aparecen ahí.

## Integraciones

Los tokens y secretos introducidos en Ronde se cifran con `SECRET_KEY` antes de guardarse, y no se vuelven a
mostrar. Guarda bien esa clave: sin ella, no se pueden volver a leer.

Los tokens de las cuentas que inician sesión con Google, GitHub, Microsoft o el inicio de sesión único también se cifran, con `AUTH_SECRET`.

| Integración | Dónde | Plan |
| --- | --- | --- |
| GitLab y GitHub: importar incidencias y merge requests en las fichas | Ajustes de la reunión | Community |
| Videollamada: cualquier enlace, Jitsi, BigBlueButton | Ajustes de la reunión | Community |
| Salas de Zoom, Google Meet y Teams creadas para cada reunión | Espacio de trabajo, General | Team |
| Calendarios de Google y Outlook: sesiones escritas en los calendarios de los participantes, disponibilidad leída | Espacio de trabajo, General | Team |
| Tickets de Jira, Linear, GitLab y GitHub a partir de las acciones de seguimiento, cerrados a la vez | Espacio de trabajo, General | Team |
| GitHub, GitLab, Jira y Linear: repositorios, hitos, épicas y proyectos importados a la cartera | Proyectos › Importar | Community |
| Proyectos importados sincronizados con su herramienta: nombre, situación, fechas y avance | Proyectos › Importar, mediante un gestor de tickets | Team |
| Tu logotipo en la pantalla compartida, en los correos y en las actas | Espacio de trabajo, General | Team |
| App de Slack: recordatorios por mensaje directo, fichas rellenadas desde Slack, `/ronde`, un canal para las notificaciones | Espacio de trabajo, General | Team |
| App de Microsoft Teams: recordatorios por mensaje personal, fichas rellenadas desde Teams, `ronde`, un canal para las notificaciones | Espacio de trabajo, General | Team |
| Notion y Confluence: el acta de cada sesión publicada como una página, actualizada con el resumen | Espacio de trabajo, General, y luego Ajustes de la reunión › Integraciones | Team |

### Slack

Con Team, los propietarios y administradores pulsan **Añadir a Slack** en la pestaña General y eligen el
canal de las notificaciones. Después:

- los recordatorios de ficha llegan por mensaje directo, con un botón **Rellenar mi ficha** que abre las
  secciones de la reunión en un formulario de Slack; las respuestas se guardan en Ronde como si se
  hubieran escrito en la página;
- el canal elegido se convierte en un conector, listo para las reglas de notificación de las reuniones
  (acta publicada, sesión a punto de empezar…);
- `/ronde` muestra a cada persona sus próximas sesiones y sus acciones de seguimiento abiertas, solo a ella.

Las personas se reconocen por su correo: su cuenta de Slack y su perfil de Ronde deben compartirlo. Quien
no aparece en Slack sigue recibiendo el recordatorio por correo. **Desconectar** quita la app de Slack y
elimina las reglas de notificación que publican en su canal. En una instancia autoalojada, el
administrador crea primero la app de Slack de la instancia (consulta la guía de autoalojamiento).

### Microsoft Teams

Una persona propietaria o administradora descarga la app de Ronde para Teams desde la pestaña General; un
administrador de Teams la carga en las aplicaciones de la organización y la añade a un equipo. En su canal,
Ronde publica una tarjeta: **Vincular a Ronde** abre Ronde, donde se elige el espacio. A partir de entonces,
los recordatorios de ficha llegan por mensaje personal a las personas encontradas en el equipo (reconocidas por
su correo), con un botón que convierte el mensaje en el formulario de la ficha; escribir «ronde» a la app
muestra las próximas sesiones y acciones abiertas de la persona; y el canal se convierte en un conector para
las reglas de notificación de las reuniones. Quitar la app del equipo, o **Desvincular** en Ronde, lo detiene
todo, y los recordatorios vuelven al correo.

### Notion y Confluence

Los propietarios y administradores añaden un wiki en la pestaña General: una página de **Notion** compartida
con una integración interna (creada en notion.so/profile/integrations; comparte la página con ella desde
••• › Conexiones), o un espacio de **Confluence**, en la nube (sitio, clave del espacio, correo de la cuenta
y un token de API de id.atlassian.com) o en un Data Center o Server (un token de acceso personal). Una
página principal opcional agrupa las actas. Después cada reunión elige su wiki en Ajustes › Integraciones:
en cada archivado, el acta se convierte en una página con la fecha de la sesión y el nombre de la reunión,
con un enlace al historial. Editar el resumen actualiza la página; las sesiones anteriores se publican
desde el historial, donde una publicación fallida explica por qué y puede reintentarse. Las reuniones de
ejemplo no publican nada.

### Asistente de IA y transcripciones

Con Team, el **asistente de IA** redacta el resumen de una sesión y propone acciones de seguimiento; el
anfitrión lo revisa todo antes de guardarlo. Usa una clave de API de Anthropic: la de la instancia
(`ANTHROPIC_API_KEY`) o la del propio espacio de trabajo.

Las **transcripciones** convierten en texto lo que se dice durante una sesión, turno a turno. Necesitan un
servicio de voz a texto: OpenAI, o tu propio servidor Whisper (el perfil `whisper` del archivo Compose
ejecuta uno en la misma máquina). Cada reunión debe permitirlas en sus ajustes, todos ven un aviso mientras
se graba una sesión, y cada persona puede excluir sus turnos. El audio se elimina en cuanto se transcribe.

## Registro de auditoría

Con Team, la pestaña **Registro de auditoría** muestra quién cambió qué en el espacio de trabajo en los
últimos 90 días: ajustes, personas, roles y reuniones, con exportación CSV. Enterprise conserva todo el
historial y puede enviar cada entrada, firmada, a un conector webhook para tu SIEM o tu plataforma de
registros.

## Copias de seguridad y actualizaciones

Todo lo que Ronde guarda está en su base de datos PostgreSQL. La
[guía de autoalojamiento](../self-hosting/README.es.md#backups) explica cómo hacer una copia de seguridad,
restaurarla y pasar a una versión nueva.
