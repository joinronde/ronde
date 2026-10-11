# Ronde को ख़ुद होस्ट करना

Ronde Docker वाली किसी भी मशीन पर चलता है: ऐप, एक PostgreSQL डेटाबेस, और एक बार चलने वाला कंटेनर जो हर
संस्करण के डेटाबेस माइग्रेशन लागू करता है। Community संस्करण में सब कुछ मुफ़्त है, मीटिंग या लोगों की कोई
सीमा नहीं। लाइसेंस कुंजी Team या Enterprise की सुविधाएँ चालू करती है।

## शुरू करें

1. किसी रिलीज़ की फ़ाइलें लें:

   ```sh
   mkdir ronde && cd ronde
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/compose.yml
   curl -fsSL https://raw.githubusercontent.com/joinronde/ronde/main/docker/.env.example -o .env
   ```

2. `.env` भरें: वह पता जो लोग खोलेंगे (`RONDE_URL`) और तीन सीक्रेट।

   ```sh
   for v in POSTGRES_PASSWORD AUTH_SECRET SECRET_KEY; do sed -i "s|^$v=.*|$v=$(openssl rand -base64 32 | tr -d '/+=')|" .env; done
   ```

3. शुरू करें:

   ```sh
   docker compose up -d
   ```

4. `RONDE_URL` खोलें और पहला खाता बनाएँ: वही इंस्टेंस का एडमिन बनता है।

## HTTPS

किसी डोमेन को मशीन की ओर पॉइंट करें, `.env` में `RONDE_DOMAIN=ronde.example.com` और
`RONDE_URL=https://ronde.example.com` सेट करें, फिर `https` प्रोफ़ाइल के साथ शुरू करें। Caddy प्रमाणपत्र लेता और
नवीनीकृत करता है।

```sh
docker compose --profile https up -d
```

अपने ख़ुद के रिवर्स प्रॉक्सी के पीछे, इसके बजाय पोर्ट `RONDE_PORT` (डिफ़ॉल्ट 3000) पर भेजें और `X-Forwarded-*`
हेडर बनाए रखें। Server-Sent Events बफ़र नहीं होने चाहिए (nginx में `proxy_buffering off`)।

## ईमेल

साइन-इन लिंक, आमंत्रण और रिमाइंडर के लिए SMTP सर्वर चाहिए:
`SMTP_URL=smtp://user:password@smtp.example.com:587` और `MAIL_FROM`। आज़माने के लिए `mail` प्रोफ़ाइल Mailpit
चालू करती है, जो हर ईमेल पकड़ लेता है:

```sh
echo "SMTP_URL=smtp://mail:1025" >> .env
docker compose --profile mail up -d   # emails at http://localhost:8025
```

रिमाइंडर का जवाब देकर हर किसी को अपना कार्ड भरने देने के लिए, Ronde को पढ़ने के लिए एक मेलबॉक्स दें: `INBOUND_IMAP_URL=imaps://user:password@imap.example.com:993/INBOX`, और जब लॉगिन ईमेल पता न हो तो `INBOUND_ADDRESS`। जवाब वहीं भेजे जाते हैं; हर मिनट Ronde रिमाइंडर के जवाब पढ़ता है, उनकी पंक्तियाँ कार्ड में जोड़ता है, ईमेल से पुष्टि करता है और उन्हें `Ronde` फ़ोल्डर में रख देता है। मेलबॉक्स के बाकी संदेश जैसे हैं वैसे रहते हैं, इसलिए यह आपका सामान्य संपर्क पता भी हो सकता है।

पुश सूचनाओं (आपकी बारी नज़दीक, कार्ड के रिमाइंडर, घंटी) के लिए इंस्टेंस को कुंजियों की एक जोड़ी चाहिए: `npx web-push generate-vapid-keys`, फिर `WEB_PUSH_PUBLIC_KEY` और `WEB_PUSH_PRIVATE_KEY`। इन्हें संभालकर रखें: जिन डिवाइस पर सूचनाएँ चालू हैं वे इन्हीं पर निर्भर हैं। Ronde को HTTPS पर चलना चाहिए; iPhone पर पहले उसे होम स्क्रीन पर जोड़ना होता है।

## साइन-इन

स्थानीय खाते और मैजिक लिंक तुरंत काम करते हैं। `SIGNUP_POLICY` तय करता है कि कौन खाता बना सकता है:
`invite-only` (डिफ़ॉल्ट), `open`, या `SIGNUP_ALLOWED_DOMAINS` के साथ `domains`। एक OpenID Connect प्रदाता
(Keycloak, Authentik, Entra ID, Okta…) `OIDC_*` वेरिएबल से सेट होता है; Google, GitHub और Microsoft अपने
`<PROVIDER>_CLIENT_ID` और `<PROVIDER>_CLIENT_SECRET` से। रीडायरेक्ट URI:
`<RONDE_URL>/api/auth/callback/<provider>`।

## आवाज़ बाहर भेजे बिना ट्रांसक्रिप्ट

ट्रांसक्रिप्ट (Team) OpenAI API वाली स्पीच-टू-टेक्स्ट सेवा का उपयोग करते हैं। आवाज़ को अपने सर्वर पर रखने के
लिए `whisper` प्रोफ़ाइल चालू करें और Ronde को उसकी ओर इंगित करें:

```sh
cat >> .env <<'ENV'
TRANSCRIPTION_URL=http://whisper:8000/v1
TRANSCRIPTION_MODEL=Systran/faster-whisper-small
ENV
docker compose --profile whisper up -d
```

## Slack

Team या Enterprise लाइसेंस के साथ, वर्कस्पेस Ronde को Slack में जोड़ सकते हैं: डायरेक्ट मैसेज से चेक-इन
रिमाइंडर, Slack फ़ॉर्म से भरे गए चेक-इन, चैनल में सूचनाएँ और `/ronde` कमांड। इंस्टेंस को अपना Slack ऐप
चाहिए, जो एक ही बार बनता है। Slack को `RONDE_URL` तक HTTPS से पहुँचना चाहिए।

1. ऐप का मैनिफ़ेस्ट लें और उसमें हर `https://ronde.example.com` को अपने `RONDE_URL` से बदलें:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/joinronde/ronde/main/docker/slack-manifest.yml
   ```

2. [api.slack.com/apps](https://api.slack.com/apps) पर: **Create New App › From a manifest**, अपना Slack
   वर्कस्पेस चुनें और फ़ाइल चिपकाएँ।
3. **Basic Information › App Credentials** की कुंजियाँ `.env` में कॉपी करें (`SLACK_CLIENT_ID`,
   `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`), फिर `docker compose up -d` चलाएँ।
4. Ronde में, हर वर्कस्पेस का मालिक या व्यवस्थापक **सेटिंग › Slack › Slack में जोड़ें** खोलता है।

ऐप को कई Slack वर्कस्पेस में जोड़ने के लिए, ऐप की सेटिंग में **Manage Distribution** चालू करें।

## Microsoft Teams

Team या Enterprise लाइसेंस के साथ वर्कस्पेस Ronde को Microsoft Teams में जोड़ सकते हैं: निजी संदेश से चेक-इन रिमाइंडर, कार्ड से भरे गए
चेक-इन, एक चैनल में सूचनाएँ, और `ronde` कमांड। इंस्टेंस को अपना Teams ऐप चाहिए, यानी आपके Microsoft संगठन में एक बार पंजीकृत
Azure Bot। Microsoft को HTTPS पर `RONDE_URL` तक पहुँचना होगा।

1. [Azure पोर्टल](https://portal.azure.com) में: **Create a resource › Azure Bot**, एक हैंडल (`ronde`), मुफ़्त **F0** प्लान,
   **Type of App: Single Tenant** और **Create new Microsoft App ID** के साथ।
2. बॉट में **Settings › Configuration**: **Messaging endpoint** को `https://ronde.example.com/api/teams/messages`
   (आपका `RONDE_URL`) पर सेट करें, सहेजें, और **Microsoft App ID** व **App Tenant ID** कॉपी करें।
3. उसी पेज पर **Manage Password** ऐप पंजीकरण खोलता है: **Certificates & secrets › New client secret**, फिर उसका
   **Value** कॉपी करें (केवल एक बार दिखता है)।
4. बॉट में **Settings › Channels**: **Microsoft Teams** जोड़ें और उसकी शर्तें स्वीकार करें।
5. तीनों मान `.env` में डालें (`TEAMS_APP_ID`, `TEAMS_TENANT_ID`, `TEAMS_APP_PASSWORD`), फिर `docker compose up -d`
   चलाएँ।
6. Ronde में, किसी वर्कस्पेस का मालिक या एडमिन **सेटिंग › Microsoft Teams** खोलकर ऐप डाउनलोड करता है। Teams एडमिन उसे अपलोड करता
   है (Teams एडमिन सेंटर › Teams ऐप › ऐप प्रबंधित करें › नया ऐप अपलोड करें) और किसी टीम में जोड़ता है: Ronde उसके चैनल में एक कार्ड
   पोस्ट करता है, और **Ronde से जोड़ें** वर्कस्पेस चुनता है।

क्लाइंट सीक्रेट 6 से 24 महीने में समाप्त हो जाता है: उससे पहले अगला बनाएँ और `TEAMS_APP_PASSWORD` बदलें। सिंगल-टेनेंट बॉट आपके अपने
Microsoft संगठन के लोगों की सेवा करता है; ऐप को दूसरे संगठनों को देने के लिए उसे Teams Store में प्रकाशित किया जाता है।

## अपग्रेड

```sh
docker compose pull && docker compose up -d
```

`migrate` कंटेनर ऐप के शुरू होने से पहले नए संस्करण के माइग्रेशन लागू करता है। कब अपग्रेड करना है यह तय करने के
लिए `.env` में `RONDE_VERSION=1.0.0-beta.3` से संस्करण तय करें।

## बैकअप

सब कुछ PostgreSQL वॉल्यूम में रहता है:

```sh
docker compose exec db pg_dump -U ronde ronde | gzip > ronde-$(date +%F).sql.gz
```

## इमेज

| इमेज | यह क्या है |
|---|---|
| `ghcr.io/joinronde/ronde` | ऐप, सभी संस्करण (लाइसेंस के बिना पेड सुविधाएँ बंद) |
| `ghcr.io/joinronde/ronde-ce` | पेड संस्करणों के कोड के बिना ऐप (केवल AGPL) |
| `ghcr.io/joinronde/ronde-migrate` | उसी संस्करण के डेटाबेस माइग्रेशन |

हर सीक्रेट वेरिएबल `<NAME>_FILE` (Docker secrets) भी स्वीकार करता है। शिक्षा: स्कूलों और विश्वविद्यालयों को पेड
प्लान मुफ़्त मिलते हैं, https://joinronde.com/hi/education पर अनुरोध करें।
