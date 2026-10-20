# Administrar o Ronde

Este guia é para as pessoas que operam o Ronde para uma organização: a administradora de uma instância
auto-hospedada, e os proprietários e administradores de um espaço de trabalho (na nuvem ou no seu próprio
servidor). Para instalar o Ronde, comece pelo [guia de auto-hospedagem](../self-hosting/README.pt.md).

## A instância

A primeira conta criada em uma nova instância se torna a sua **administradora**. Ela abre
**Administração do servidor** no menu do espaço, no canto superior esquerdo (`/admin`), onde pode:

- ver quantas contas, espaços de trabalho e reuniões a instância contém;
- escolher o idioma padrão, usado quando nem a pessoa nem o navegador pedem um idioma que o Ronde fala;
- decidir quem pode criar uma conta;
- informar ou remover a chave de licença.

Os valores salvos nesta página têm prioridade sobre as variáveis de ambiente. As configurações próprias de
cada espaço (membros, funções, segurança) ficam nas **Configurações** dele.

Na nuvem, a equipe do Ronde cuida do servidor: não há Administração do servidor, qualquer pessoa pode
criar uma conta e o plano de cada espaço vem da sua assinatura.

### Quem pode criar uma conta

| Política | Quem pode se cadastrar |
| --- | --- |
| Por convite (padrão) | Somente pessoas convidadas para um espaço de trabalho |
| Domínios de e-mail | Pessoas convidadas, e qualquer pessoa com um endereço dos domínios listados |
| Aberta | Qualquer pessoa que acesse a instância |

A mesma escolha pode ser feita com `SIGNUP_POLICY` (`invite-only`, `domains`, `open`) e
`SIGNUP_ALLOWED_DOMAINS`.

### Chave de licença

Os recursos do Team e do Enterprise são ativados com uma chave de licença, informada em Administração do
servidor ou na variável `RONDE_LICENSE` (a variável prevalece e bloqueia o campo). A chave é verificada no
servidor, offline: nada é enviado a lugar nenhum. A página mostra o plano, o cliente, a data de expiração e
quantas licenças estão em uso.

- **Uma licença** corresponde a uma pessoa que participou de uma reunião nos últimos 30 dias, como na nuvem do
  Ronde. Quem foi convidado e nunca veio, ou ficou ausente o mês todo, não ocupa nenhuma, e uma pessoa em vários
  espaços de trabalho (com a mesma conta ou o mesmo endereço) conta uma única vez.
- **O máximo** de cada licença fica registrado enquanto ela é válida (ativa ou no período de carência), contado
  toda noite e a cada vez que a página é aberta. É nele que a renovação se baseia. Uma nova chave começa a sua
  própria contagem, e a página continua mostrando o máximo da licença anterior, para acertá-lo.
- **Mais pessoas do que licenças**: nada é bloqueado. A página avisa, e a diferença é acertada na renovação.
- **Expirada**: um período de carência de 14 dias mantém tudo funcionando. Depois dele, os recursos pagos
  passam a ser somente leitura: o que contêm continua legível, mas nada novo pode ser adicionado. Os
  recursos do Community nunca são afetados.
- A imagem `ronde-ce` é compilada apenas com o código aberto e não consegue ler uma chave de licença: use a
  imagem `ronde` para o Team ou o Enterprise.

Escolas e universidades recebem uma licença Enterprise gratuita: escreva para hello@joinronde.com pelo
endereço da sua instituição.

### Ocultar os planos pagos

Os administradores veem sugestões discretas sobre os recursos pagos nas configurações (nunca durante uma
reunião). Defina `RONDE_HIDE_UPGRADE_HINTS=1` para removê-las de toda a instância.

### Feedback dos usuários

O botão em forma de balão no topo das páginas (no menu da conta, no celular) permite relatar um problema ou sugerir
uma ideia, com uma captura de tela se quiserem. Junto com a mensagem vão o endereço da página (sem os parâmetros), o
navegador, o tamanho da janela, o idioma e a versão do Ronde. Os administradores leem as mensagens em
**Administração do servidor**, respondem por e-mail a quem pediu e podem abrir uma issue pré-preenchida no projeto
Ronde para um problema do próprio Ronde. Com `SENTRY_DSN` definido, as mensagens também chegam a esse projeto do
Sentry como feedback de usuários. As mensagens são apagadas após um ano; numa instância auto-hospedada, o botão fica desativado por padrão: `RONDE_FEEDBACK=on` o exibe.

## Espaços de trabalho

Um espaço de trabalho reúne as pessoas, as reuniões, os modelos e os conectores de uma equipe. Qualquer
pessoa autorizada a se cadastrar pode criar um; uma pessoa pode pertencer a vários. As configurações ficam em
**Configurações**, na barra lateral:

| Aba | O que contém | Quem vê |
| --- | --- | --- |
| Geral | Nome, link, idioma, categorias profissionais, quem pode criar reuniões, conectores e integrações | Todos; proprietários e administradores alteram |
| Segurança | Domínios verificados, provedores de identidade, LDAP, SCIM | Proprietários e administradores (Enterprise) |
| Papéis | Papéis personalizados | Proprietários e administradores (Enterprise) |
| Registro de auditoria | Quem mudou o quê | Proprietários e administradores (Team, Enterprise) |
| Cobrança | Plano e faturas | Proprietários e o papel Cobrança, na nuvem |
| Planos | O que o Team e o Enterprise acrescentam, e onde obtê-los | Proprietários e administradores, auto-hospedado |

### Papéis

Cada membro tem um papel no espaço de trabalho:

| Papel | Pode |
| --- | --- |
| Proprietário | Tudo, incluindo a cobrança e a exclusão do espaço de trabalho |
| Administrador | Tudo, exceto cobrança e exclusão; atua como anfitrião de todas as reuniões |
| Cobrança | O plano, as faturas e a forma de pagamento, nada mais (na nuvem) |
| Organizador | O que um membro pode fazer, mais criar reuniões quando a criação é reservada aos administradores, e convidar pessoas |
| Membro | Ver o diretório, criar reuniões (a menos que sejam reservadas a organizadores e administradores), salvar modelos |
| Convidado | Somente as reuniões para as quais foi convidado |

Cada pessoa em uma reunião também tem um papel nessa reunião:

| Papel | Pode |
| --- | --- |
| Anfitrião | Conduzir as sessões, configurar a reunião, gerenciar as pessoas, editar a ata |
| Coanfitrião | Conduzir as sessões e editar a ata, sem alterar as configurações nem as pessoas da reunião |
| Participante | Preencher a própria ficha, participar das sessões, ler o histórico |
| Observador | Acompanhar as sessões e ler o histórico |

Quem cria uma reunião é o anfitrião dela. Com o Enterprise, os **papéis personalizados** acrescentam
permissões a membros e convidados; as permissões de reunião deles valem para todas as reuniões do espaço de
trabalho.

### Pessoas e convites

O **diretório** é compartilhado por todas as reuniões do espaço de trabalho: o nome de uma pessoa, o
aniversário (só dia e mês), a categoria profissional e as contas no GitLab ou no GitHub são informados uma
única vez. É possível adicionar pessoas sem conta, para uma reunião em que elas não fazem login; convidá-las
envia um e-mail com um link válido por 14 dias. Remover um membro encerra o acesso dele; as fichas e o
histórico ficam no espaço de trabalho. Com SCIM, as pessoas desativadas no seu diretório perdem o acesso da
mesma forma.

### Ausências

Cada pessoa pode adicionar as suas ausências no perfil (quem gerencia pessoas pode fazer isso por qualquer
um): um primeiro e um último dia, uma nota, e quem conduz nesse período as reuniões que ela organiza.
Durante uma ausência, a pessoa é marcada como ausente nas sessões desses dias, não recebe lembretes, e o
perfil mostra quando ela volta. A pessoa indicada como substituta recebe uma notificação e conduz essas
reuniões como anfitriã, somente nesses dias.

### Margem entre reuniões

Na aba Geral, **Margem entre duas reuniões** (nenhuma, 5, 10, 15 ou 30 minutos) é mantida livre antes e
depois de cada reunião de uma pessoa. “Encontrar um horário” a respeita, e a agenda de uma reunião sinaliza
as datas que ficam perto demais de outra reunião das mesmas pessoas.

## Login e login único

A edição Community oferece contas com e-mail e senha, links de login por e-mail, verificação em duas
etapas, contas Google, GitHub e Microsoft, e um provedor OpenID Connect para a instância (variáveis
`OIDC_*`, veja o [guia de auto-hospedagem](../self-hosting/README.pt.md)).

Cada pessoa gerencia como entra a partir da sua conta, em **Login e segurança**: senha, chaves de acesso (Face ID, Windows Hello, um gerenciador de senhas ou uma chave de segurança), verificação em duas etapas e saída de todos os dispositivos. As chaves de acesso ficam ligadas ao domínio de `APP_URL`, que deve usar HTTPS: depois de uma mudança de domínio, cada pessoa as adiciona de novo. Um endereço que precisa usar login único não pode adicionar nem usar chaves de acesso.

Com o Enterprise, a aba **Segurança** de um espaço de trabalho acrescenta:

1. **Domínios verificados.** Adicione o seu domínio de e-mail e o registro DNS mostrado, depois verifique-o.
   Um domínio verificado pode:
   - **capturar as novas contas**: quem se cadastrar com um endereço do domínio entra no espaço de trabalho
     como membro;
   - **exigir login único**: os endereços dele entram somente pelo seu provedor, sem senha nem link por
     e-mail. Confirme que o provedor funciona para você antes de ativar.
2. **Provedores de identidade**, OpenID Connect ou SAML (Okta, Entra ID, Google Workspace, Keycloak…), para
   os endereços dos seus domínios verificados. A página informa a URI de redirecionamento ou a URL de
   resposta (ACS) e o entity ID a configurar no provedor.
3. **Diretório da empresa (LDAP ou Active Directory).** As pessoas entram com a senha do diretório. O Ronde
   as procura com uma conta de serviço e verifica a senha sem guardá-la. Use `ldaps://`, ou `ldap://` com
   StartTLS.
4. **Provisionamento (SCIM).** O seu diretório (Okta, Entra ID, JumpCloud…) cria as pessoas, mantém nome e
   endereço atualizados e as remove quando saem. A aba informa o endpoint SCIM e um token.

Uma instância atrás de um proxy reverso que autentica pode, em vez disso, confiar no endereço que ele
repassa em um cabeçalho (`AUTH_TRUSTED_EMAIL_HEADER`); faça isso somente se nada mais conseguir acessar o
Ronde.

## Reuniões

Proprietários e administradores podem restringir a criação de reuniões a organizadores e administradores na aba Geral.
Depois, cada reunião tem as próprias configurações, abertas aos anfitriões: agenda, pessoas e papéis, seções
da ficha, pauta, módulos, aparência, notificações, videochamada e integrações. Uma reunião pode ser salva
como modelo do espaço de trabalho, sem as pessoas, o histórico ou os tokens.

Uma reunião começa com o emoji do seu modelo, exibido ao lado do nome nos menus; em Configurações › Aparência, os anfitriões escolhem outro emoji ou enviam uma imagem (um logotipo, uma foto da equipe).

### Sessões na hora

**Começar agora**, no cartão de uma reunião, faz uma sessão imediatamente, fora da agenda: a equipe é
avisada (sino e regras de notificação “sessão iniciada”) e a sala de controle se abre. A sessão recebe a data
de hoje; a data prevista continua na agenda. Iniciar pela sala de controle uma sessão preparada para outro
dia tem o mesmo efeito.

### Reunião de exemplo

Antes da primeira reunião, o início de um espaço oferece uma reunião de exemplo: uma reunião semanal com uma equipe fictícia de cinco pessoas, um mês de sessões arquivadas com atas, estatísticas e ações, e uma sessão pronta para começar, tudo no idioma do espaço. Ela serve para experimentar tudo: não envia nada (nem lembretes, nem e-mails, nem eventos de agenda, nem notificações), não ocupa nenhuma licença, não marca nenhum dos primeiros passos e fica fora das análises e relatórios do espaço. Um aviso nas suas páginas indica isso, e **Excluir o exemplo** a apaga de vez com sua equipe fictícia (uma pessoa dessa equipe adicionada a outra reunião é mantida). Suas pessoas aparecem como Exemplo no diretório e não podem ser convidadas.

### Feriados

Na aba Geral, um espaço escolhe os feriados de um país, e de uma região quando diferem (um estado alemão, uma comunidade espanhola…); um espaço novo começa com os do país do seu fuso horário. Uma sessão que cai em um desses dias é pulada: a data seguinte é preparada, os lembretes e as agendas acompanham, e a agenda nomeia o feriado. Na sua agenda, uma reunião pode seguir outros feriados ou nenhum, e o anfitrião ainda pode manter ou mover cada sessão pulada. Os feriados vêm do projeto date-holidays, com base na Wikipédia (CC BY-SA 3.0).

### Links de convidado

Nas configurações de uma reunião, **Pessoas › Links de convidado** cria um link secreto para pessoas sem
conta (um cliente, um conselho, um parceiro). Ele abre a tela compartilhada, ao vivo e só para leitura, até
expirar (de 1 a 90 dias) ou até um anfitrião revogá-lo. O link é mostrado uma única vez, na criação; o Ronde
guarda apenas o hash.

### Projetos e portfólio

A página **Projetos** de um espaço reúne seu portfólio: cada projeto, assunto ou frente de trabalho, com um
resumo de uma linha, uma descrição, um tema, um status, uma situação (no caminho certo, em risco, em
dificuldade), um responsável, as pessoas que trabalham nele, datas e links. Os membros podem criar
projetos; o responsável e os administradores os editam. A página de um projeto reúne o que cada reunião
disse sobre ele, sessão após sessão, para as pessoas que podem ler essas reuniões.

Cada projeto pode ter um logo, ao lado do nome e na sua etapa das reuniões: clique na sua marca, na página do projeto, para escolher uma imagem; sem logo, as iniciais aparecem sobre a sua cor. Uma importação traz a imagem da ferramenta: o avatar de uma organização do GitHub, o de um projeto do GitLab ou de um projeto do Jira. Quem pode editar o projeto o troca ou o remove.

Uma reunião acompanha projetos em **Configurações › Projetos**. Cada projeto acompanhado ganha uma aba na
ficha de cada pessoa, com uma ficha compartilhada: a situação e a mensagem do dia, escritas por quem
trabalha nele. Adicione o bloco **Rodada por projeto** à pauta para dar a cada projeto a sua vez, em que
seus membros falam juntos; sem ele, os itens sobre um projeto são apresentados na vez de cada pessoa. Os
modelos **Revisão de portfólio** e **Equipe e projetos** já vêm com ele. Com o Team, um painel mostra a
situação de cada projeto semana após semana, os prazos e os projetos sem notícias, exporta tudo em CSV e
acrescenta os projetos a acompanhar ao relatório por e-mail. Com o Enterprise, um projeto pode fazer parte de outro, que vira um programa (três níveis no máximo), ser visível só para seus membros e ser editável pelos membros, não só pelo responsável.

**Importar**, na mesma página, traz projetos das suas ferramentas: os repositórios de uma organização do GitHub ou os projetos de um grupo do GitLab, os marcos de um repositório do GitHub ou de um projeto do GitLab (cada um chamado “repositório · marco”), os épicos de um projeto do Jira ou os projetos do Linear. Marque os que quer trazer; os que já estão no portfólio são reconhecidos, e cada item entra uma única vez. O token digitado ali só serve para essa importação e não é guardado:

- GitHub: nenhum para repositórios públicos; para os privados, um token refinado que possa lê-los (Metadata, e Issues para os marcos).
- GitLab: nenhum para grupos e projetos públicos; caso contrário, um token de acesso pessoal, de grupo ou de projeto com o escopo `read_api`.
- Jira: um token de API da conta cujo e-mail é informado (id.atlassian.com › Segurança › Tokens de API).
- Linear: uma chave de API pessoal.

Os membros importam a partir de github.com, gitlab.com, Atlassian Cloud e Linear; importar de outro servidor (GitHub Enterprise, um GitLab autogerenciado, Jira Data Center) e pelos gerenciadores de tickets salvos nas configurações do espaço é reservado aos administradores do espaço. Com o Team, importar por um desses gerenciadores mantém os projetos sincronizados a cada hora: nome, status, datas e progresso seguem a ferramenta, o que a ferramenta não fornece fica como definido no Ronde (um repositório dá o seu nome e passa a “Concluído” quando arquivado), e o progresso aparece nos cartões e nas reuniões enquanto está atualizado. A página do projeto oferece **Atualizar agora** e **Parar de sincronizar**. A sincronização para de vez com **Parar de sincronizar**, quando o gerenciador de tickets é removido ou aponta para outro servidor, e fica em pausa enquanto o espaço não está no Team. Um item que a ferramenta não encontra mais (excluído, ou fora do alcance do token) é tentado de novo uma vez por dia. Projetos arquivados não são atualizados até serem restaurados.

### Módulos

Todos os módulos de facilitação são gratuitos: quebra-gelo, humor da equipe, avaliação de utilidade, reações, mãos levantadas,
agradecimentos, destaque, roleta e sorteios, aniversários, sons, timebox, enquetes, estacionamento, registro
de decisões, retrospectiva, planning poker e reuniões assíncronas. Um módulo desativado em uma reunião some
da sala de controle, da tela compartilhada e das fichas; as configurações dele são mantidas.

A avaliação de utilidade pergunta a todos, no encerramento, se a reunião foi útil (de 1 a 5 estrelas, pela própria tela ou celular). A média aparece a partir de 3 avaliações, para que ninguém consiga adivinhar a nota de outra pessoa; ela vai para a ata e para as estatísticas. Os modelos de reuniões diárias curtas, de reuniões individuais e de órgãos formais (comitê de direção, conselhos, conselho de classe, reunião de obra, discussão de casos, revisão de incidentes) a deixam desativada.

### Exportações

As páginas que listam algo o exportam para uma planilha: **Exportar em CSV** na página Ações (todas as
ações da visão, inclusive as feitas há mais de duas semanas), na página Decisões (com a busca e o filtro
por reunião), nas Estatísticas de uma reunião (uma linha por sessão) e, com o Team, na tabela de Análises
e no Painel do portfólio. As atas são baixadas em Markdown ou PDF pelo Histórico. Os arquivos abrem
direto em colunas no Excel, LibreOffice ou Numbers, no idioma da pessoa (";" e vírgula decimal em
francês, alemão, espanhol, italiano, português e russo), e um texto que parece uma fórmula continua
sendo texto.

## Notificações

Os **conectores** são os canais onde as reuniões podem publicar: e-mail, Matrix (Tchap), Slack, Microsoft
Teams, Discord, Mattermost, ou um webhook assinado com HMAC. Proprietários e administradores os adicionam na
aba Geral do espaço de trabalho. Depois, cada reunião escolhe, nas configurações de notificações, quais
eventos vão para qual conector: uma sessão prestes a começar, iniciada ou encerrada, ata publicada, lembrete
de ficha, ação atrasada, aniversário.

Toda segunda a partir das 8h (fuso do espaço), cada membro recebe um **resumo semanal** por e-mail: suas
sessões da semana com um link para cada ficha, suas ações de acompanhamento em aberto e os agradecimentos
recebidos. Ele só é enviado quando há algo nele; cada pessoa o desativa na sua conta ou pelo link no rodapé do
e-mail. Numa instância auto-hospedada, precisa de `SMTP_URL`; `RONDE_WEEKLY_PER_RUN` (150 por padrão) limita
os envios por hora, e o restante sai na hora seguinte.

Com o Team, os fluxos de notificação adicionam condições e suas próprias palavras a cada mensagem, e mais dois
conectores enviam **SMS** e mensagens de **WhatsApp** pelo Twilio: informe o Account SID, o número de envio e
o auth token. As mensagens vão para os números de celular que as pessoas informam no perfil (formato
internacional, +55…), nunca para quem está ausente. No WhatsApp, o remetente precisa ser aprovado no Twilio, e
o WhatsApp só deixa uma empresa escrever primeiro com um modelo aprovado pela Meta: crie um no Content
Template Builder do Twilio com duas variáveis (a mensagem e depois o link) e informe o Content SID dele no
conector. Quando um espaço de trabalho sai do Team, essas mensagens param e o registro de cada reunião diz por
quê.

**Ficha por e-mail**: quando a instância lê uma caixa de correio (`INBOUND_IMAP_URL`, veja o guia de auto-hospedagem), o lembrete indica que basta responder. O nome de cada seção em uma linha e os itens abaixo: as linhas são acrescentadas à ficha da pessoa (sem substituir nada) e um e-mail confirma o que entrou. Só contam respostas do endereço do lembrete (ou do da conta da pessoa), por 14 dias; observadores e a reunião de exemplo ficam de fora.

**Notificações push**: quando a instância tem suas chaves (veja o guia de auto-hospedagem), cada pessoa pode instalar o Ronde pelo navegador (ou adicioná-lo à Tela de Início de um iPhone) e, na sua conta, ativar as notificações em cada dispositivo: sua vez se aproximando durante uma sessão ao vivo, os lembretes de ficha e o que chega no sino. Cada tipo pode ser desativado, e os dispositivos ficam listados ali.

## Integrações

Tokens e segredos informados no Ronde são criptografados com `SECRET_KEY` antes de serem salvos, e nunca
mais são mostrados. Guarde bem essa chave: sem ela, não é possível lê-los de volta.

Os tokens das contas que entram com Google, GitHub, Microsoft ou login único também são criptografados, com `AUTH_SECRET`.

| Integração | Onde | Plano |
| --- | --- | --- |
| GitLab e GitHub: importar issues e merge requests para as fichas | Configurações da reunião | Community |
| Videochamada: qualquer link, Jitsi, BigBlueButton | Configurações da reunião | Community |
| Salas do Zoom, Google Meet e Teams criadas para cada reunião | Espaço de trabalho, Geral | Team |
| Agendas Google, Outlook e CalDAV (iCloud, Fastmail, Nextcloud…), nos dois sentidos: sessões gravadas nas agendas dos participantes, mudanças, exclusões e respostas feitas lá trazidas de volta, disponibilidade lida | Espaço de trabalho, Geral | Team |
| Tickets no Jira, Linear, GitLab e GitHub a partir das ações de acompanhamento, fechados juntos | Espaço de trabalho, Geral | Team |
| GitHub, GitLab, Jira e Linear: repositórios, marcos, épicos e projetos importados para o portfólio | Projetos › Importar | Community |
| Projetos importados sincronizados com a sua ferramenta: nome, status, datas e progresso | Projetos › Importar, por um gerenciador de tickets | Team |
| O seu logotipo na tela compartilhada, nos e-mails e nas atas | Espaço de trabalho, Geral | Team |
| App do Slack: lembretes por mensagem direta, fichas preenchidas no Slack, `/ronde`, um canal para as notificações | Espaço de trabalho, Geral | Team |
| App do Microsoft Teams: lembretes por mensagem pessoal, fichas preenchidas no Teams, `ronde`, um canal para as notificações | Espaço de trabalho, Geral | Team |
| Notion e Confluence: a ata de cada sessão publicada como página, atualizada com o resumo | Espaço de trabalho, Geral, depois Configurações da reunião › Integrações | Team |

### Slack

Com Team, proprietários e administradores clicam em **Adicionar ao Slack** na aba Geral e escolhem o canal
das notificações. Depois:

- os lembretes de ficha chegam por mensagem direta, com um botão **Preencher minha ficha** que abre as
  seções da reunião em um formulário do Slack; as respostas são salvas no Ronde como se tivessem sido
  digitadas na página;
- o canal escolhido vira um conector, pronto para as regras de notificação das reuniões (ata publicada,
  sessão prestes a começar…);
- `/ronde` mostra a cada pessoa as próximas sessões e as ações de acompanhamento em aberto, só para ela.

As pessoas são reconhecidas pelo e-mail: a conta do Slack e o perfil no Ronde devem ter o mesmo. Quem não
é encontrado no Slack continua recebendo o lembrete por e-mail. **Desconectar** remove o app do Slack e
exclui as regras de notificação que publicam no canal dele. Em uma instância auto-hospedada, o
administrador cria antes o app do Slack da instância (veja o guia de auto-hospedagem).

### Microsoft Teams

Uma pessoa proprietária ou administradora baixa o app do Ronde para o Teams na aba Geral; um administrador do
Teams o carrega nos aplicativos da organização e o adiciona a uma equipe. No canal, o Ronde publica um cartão:
**Vincular ao Ronde** abre o Ronde, onde se escolhe o espaço. A partir daí, os lembretes de ficha vão por
mensagem pessoal às pessoas encontradas na equipe (reconhecidas pelo e-mail), com um botão que transforma a
mensagem no formulário da ficha; escrever “ronde” para o app lista as próximas sessões e ações em aberto da
pessoa; e o canal vira um conector para as regras de notificação das reuniões. Remover o app da equipe, ou
**Desvincular** no Ronde, interrompe tudo, e os lembretes voltam para o e-mail.

### Notion e Confluence

Proprietários e administradores adicionam um wiki na aba Geral: uma página do **Notion** compartilhada com
uma integração interna (criada em notion.so/profile/integrations; compartilhe a página com ela em
••• › Conexões), ou um espaço do **Confluence**, na nuvem (site, chave do espaço, e-mail da conta e um token
de API de id.atlassian.com) ou em um Data Center ou Server (um token de acesso pessoal). Uma página
principal opcional reúne as atas. Depois cada reunião escolhe o seu wiki em Configurações › Integrações: a
cada arquivamento, a ata vira uma página com a data da sessão e o nome da reunião, com um link para o
histórico. Editar o resumo atualiza a página; as sessões anteriores são publicadas pelo histórico, onde
uma publicação que falhou explica o motivo e pode ser refeita. Reuniões de exemplo não publicam nada.

### Assistente de IA e transcrições

Com o Team, o **assistente de IA** redige o resumo de uma sessão e sugere ações de acompanhamento; o
anfitrião revisa tudo antes de salvar. Ele usa uma chave de API da Anthropic: a da instância
(`ANTHROPIC_API_KEY`) ou a do próprio espaço de trabalho.

As **transcrições** transformam em texto o que é dito durante uma sessão, organizado por vez da rodada (o que é dito fora da rodada não é atribuído a ninguém). Elas precisam de um
serviço de voz para texto: OpenAI, ou um servidor Whisper próprio (o perfil `whisper` do arquivo Compose roda
um na mesma máquina). Cada reunião precisa permiti-las nas configurações, todos veem um aviso enquanto uma
sessão é gravada, e cada pessoa pode excluir as próprias vezes. O áudio é excluído assim que é transcrito.

## Registro de auditoria

Com o Team, a aba **Registro de auditoria** lista quem mudou o quê no espaço de trabalho nos últimos 90 dias:
configurações, pessoas, papéis e reuniões, com exportação CSV. O Enterprise guarda todo o histórico e pode
enviar cada entrada, assinada, para um conector webhook do seu SIEM ou da sua plataforma de logs.

## Backups e atualizações

Tudo o que o Ronde guarda fica no banco de dados PostgreSQL. O
[guia de auto-hospedagem](../self-hosting/README.pt.md#backups) explica como fazer backup, restaurar e
passar para uma nova versão.
