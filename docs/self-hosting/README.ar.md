# استضافة Ronde ذاتيًا

يعمل Ronde على أي جهاز مزوّد بـ Docker: التطبيق، وقاعدة بيانات PostgreSQL، وحاوية تعمل مرة واحدة لتطبّق
عمليات ترحيل قاعدة البيانات في كل إصدار. كل ما في إصدار Community مجاني، بلا حد للاجتماعات أو الأشخاص. ويفعّل
مفتاح الترخيص ميزات Team أو Enterprise.

## البدء

1. احصل على الملفات:

   ```sh
   mkdir ronde && cd ronde
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/compose.yml
   curl -fsSL https://raw.githubusercontent.com/joinronde/ronde/main/docker/.env.example -o .env
   ```

2. املأ ملف `.env`: اضبط العنوان الذي سيفتحه الناس (`RONDE_URL`)، ثم أنشئ الأسرار الثلاثة:

   ```sh
   for v in POSTGRES_PASSWORD AUTH_SECRET SECRET_KEY; do sed -i "s|^$v=.*|$v=$(openssl rand -base64 32 | tr -d '/+=')|" .env; done
   ```

3. شغّل:

   ```sh
   docker compose up -d
   ```

4. افتح `RONDE_URL` وأنشئ الحساب الأول: يصبح مسؤول النسخة.

## HTTPS

وجّه نطاقًا إلى الجهاز، واضبط `RONDE_DOMAIN=ronde.example.com` و`RONDE_URL=https://ronde.example.com` في ملف
`.env`، ثم شغّل باستخدام الملف التعريفي `https`. يحصل Caddy على الشهادة ويجدّدها.

```sh
docker compose --profile https up -d
```

إن كان لديك وكيل عكسي خاص بك، فوجّه الطلبات بدلًا من ذلك إلى المنفذ `RONDE_PORT` (3000 افتراضيًا) وحافظ على
ترويسات `X-Forwarded-*`. يجب ألا تُخزَّن أحداث Server-Sent Events مؤقتًا (`proxy_buffering off` مع nginx).

## البريد الإلكتروني

تحتاج روابط تسجيل الدخول والدعوات والتذكيرات إلى خادم SMTP: `SMTP_URL=smtp://user:password@smtp.example.com:587`
و`MAIL_FROM`. للتجربة، يشغّل الملف التعريفي `mail` أداة Mailpit التي تلتقط كل الرسائل:

```sh
echo "SMTP_URL=smtp://mail:1025" >> .env
docker compose --profile mail up -d   # emails at http://localhost:8025
```

ليتمكن كل شخص من ملء بطاقته بالرد على التذكير، امنح Ronde صندوق بريد ليقرأه: `INBOUND_IMAP_URL=imaps://user:password@imap.example.com:993/INBOX`، و`INBOUND_ADDRESS` إن لم يكن اسم الدخول هو عنوان البريد. تُرسَل الردود إليه؛ وفي كل دقيقة يقرأ Ronde الردود على التذكيرات، ويضيف أسطرها إلى البطاقة، ويؤكد ذلك بالبريد، وينقلها إلى مجلد `Ronde`. تبقى بقية رسائل الصندوق على حالها، فيمكن أن يكون عنوان التواصل المعتاد لديك.

تحتاج الإشعارات الفورية (اقتراب دورك، تذكيرات البطاقة، الجرس) إلى زوج مفاتيح للنسخة: أنشئهما بالأمر `npx web-push generate-vapid-keys`، ثم اضبط `WEB_PUSH_PUBLIC_KEY` و`WEB_PUSH_PRIVATE_KEY`. احتفظ بهما: الأجهزة التي فعّلت الإشعارات تعتمد عليهما. يجب أن يُقدَّم Ronde عبر HTTPS؛ وعلى iPhone يضيفه الأشخاص أولًا إلى الشاشة الرئيسية.

## تسجيل الدخول

تعمل الحسابات المحلية والروابط السحرية فورًا. يحدد `SIGNUP_POLICY` من يمكنه إنشاء حساب: `invite-only`
(افتراضيًا)، أو `open`، أو `domains` مع `SIGNUP_ALLOWED_DOMAINS`. يُضبط مزوّد OpenID Connect واحد (Keycloak،
Authentik، Entra ID، Okta…) بمتغيرات `OIDC_*`؛ وGoogle وGitHub وMicrosoft بمتغيراتها `<PROVIDER>_CLIENT_ID`
و`<PROVIDER>_CLIENT_SECRET`. عنوان إعادة التوجيه: `<RONDE_URL>/api/auth/callback/<provider>`.

## تفريغ نصي دون إرسال الصوت إلى الخارج

يستخدم التفريغ النصي (Team) خدمة لتحويل الكلام إلى نص متوافقة مع واجهة OpenAI. لإبقاء الصوت على خوادمك، شغّل
الملف التعريفي `whisper` ووجّه Ronde إليه:

```sh
cat >> .env <<'ENV'
TRANSCRIPTION_URL=http://whisper:8000/v1
TRANSCRIPTION_MODEL=Systran/faster-whisper-small
ENV
docker compose --profile whisper up -d
```

## Slack

مع ترخيص Team أو Enterprise، يمكن لمساحات العمل إضافة Ronde إلى Slack: تذكيرات البطاقة برسائل مباشرة،
وبطاقات تُملأ من نموذج Slack، وإشعارات في قناة، والأمر `/ronde`. تحتاج النسخة إلى تطبيق Slack خاص بها
يُنشأ مرة واحدة. يجب أن يصل Slack إلى `RONDE_URL` عبر HTTPS.

1. نزّل بيان التطبيق واستبدل فيه كل `https://ronde.example.com` بعنوان `RONDE_URL` لديك:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/slack-manifest.yml
   ```

2. في [api.slack.com/apps](https://api.slack.com/apps): **Create New App › From a manifest**، اختر مساحة
   Slack لديك والصق الملف.
3. انسخ مفاتيح **Basic Information › App Credentials** إلى `.env` (`SLACK_CLIENT_ID` و
   `SLACK_CLIENT_SECRET` و`SLACK_SIGNING_SECRET`)، ثم شغّل `docker compose up -d`.
4. في Ronde، يفتح مالك كل مساحة عمل أو مسؤولها **الإعدادات › Slack › إضافة إلى Slack**.

لإضافة التطبيق إلى عدة مساحات Slack، فعّل **Manage Distribution** في إعدادات التطبيق.

## Microsoft Teams

مع ترخيص Team أو Enterprise، يمكن لمساحات العمل إضافة Ronde إلى Microsoft Teams: تذكيرات البطاقة برسالة
شخصية، وبطاقات تُملأ من بطاقة تفاعلية، وإشعارات في قناة، والأمر `ronde`. تحتاج النسخة إلى تطبيق Teams خاص بها،
أي Azure Bot يُسجَّل مرة واحدة في مؤسستك على Microsoft. يجب أن تصل Microsoft إلى `RONDE_URL` عبر HTTPS.

1. في [بوابة Azure](https://portal.azure.com): **Create a resource › Azure Bot**، مع معرّف (`ronde`)، والخطة
   المجانية **F0**، و**Type of App: Single Tenant**، و**Create new Microsoft App ID**.
2. في البوت، **Settings › Configuration**: اضبط **Messaging endpoint** على
   `https://ronde.example.com/api/teams/messages` (عنوان `RONDE_URL` لديك)، واحفظ، وانسخ **Microsoft App ID**
   و**App Tenant ID**.
3. يفتح **Manage Password** في الصفحة نفسها تسجيل التطبيق: **Certificates & secrets › New client secret**، ثم
   انسخ **Value** الخاصة به (تظهر مرة واحدة).
4. في البوت، **Settings › Channels**: أضف **Microsoft Teams** واقبل شروطه.
5. ضع القيم الثلاث في `.env` (`TEAMS_APP_ID` و`TEAMS_TENANT_ID` و`TEAMS_APP_PASSWORD`)، ثم شغّل
   `docker compose up -d`.
6. في Ronde، يفتح مالك مساحة العمل أو مسؤولها **الإعدادات › Microsoft Teams** وينزّل التطبيق. يحمّله مسؤول
   Teams (مركز إدارة Teams › تطبيقات Teams › إدارة التطبيقات › تحميل تطبيق جديد) ويضيفه إلى فريق: ينشر Ronde
   بطاقة في قناته، ويتيح زر **الربط بـ Ronde** اختيار مساحة العمل.

تنتهي صلاحية سر العميل بعد 6 إلى 24 شهرًا: أنشئ سرًا جديدًا قبل انتهاء صلاحيته واستبدل به قيمة `TEAMS_APP_PASSWORD`. يخدم البوت
أحادي المستأجر أشخاص مؤسستك على Microsoft؛ ولتقديم التطبيق لمؤسسات أخرى، يجب نشره في Teams Store.

## الترقية

```sh
docker compose pull && docker compose up -d
```

تطبّق الحاوية `migrate` عمليات ترحيل الإصدار الجديد قبل بدء التطبيق. ثبّت إصدارًا بـ `RONDE_VERSION=1.0.0-beta.3` في
ملف `.env` لتختار موعد الترقية بنفسك.

## النسخ الاحتياطية

كل شيء موجود في وحدة تخزين PostgreSQL:

```sh
docker compose exec db pg_dump -U ronde ronde | gzip > ronde-$(date +%F).sql.gz
```

## صور Docker

| الصورة | ما هي |
|---|---|
| `ghcr.io/joinronde/ronde` | التطبيق، بكل الإصدارات (الميزات المدفوعة معطّلة بلا ترخيص) |
| `ghcr.io/joinronde/ronde-ce` | التطبيق دون شيفرة الإصدارات المدفوعة (AGPL فقط) |
| `ghcr.io/joinronde/ronde-migrate` | عمليات ترحيل قاعدة البيانات للإصدار نفسه |

يقبل كل متغير سري أيضًا الصيغة `<NAME>_FILE` (أسرار Docker). التعليم: تحصل المدارس والجامعات على الخطط المدفوعة
مجانًا، اطلبها من https://joinronde.com/ar/education.
