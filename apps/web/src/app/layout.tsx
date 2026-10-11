import { dirOf, resolveLocale } from "@ronde/i18n";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { ServiceWorker } from "@/components/service-worker";
import { env } from "@/lib/server/env";
import { withBasePath } from "@/lib/shared/base-path";
// Headlines in the condensed cut of the text's family; Russian, which it lacks, falls back to IBM Plex Sans
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import "@fontsource/ibm-plex-sans-condensed/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
// Arabic and Hindi in the same family; each file only loads when a page shows those letters
import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import "@fontsource/ibm-plex-sans-devanagari/devanagari-400.css";
import "@fontsource/ibm-plex-sans-devanagari/devanagari-600.css";
import "@ronde/ui/styles/tokens.css";
import "@ronde/ui/styles/base.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pages");
  return {
    title: "Ronde",
    description: t("description"),
    icons: {
      icon: [
        { url: withBasePath("/icon.svg"), type: "image/svg+xml" },
        { url: withBasePath("/icon.png"), type: "image/png", sizes: "512x512" },
      ],
      // iOS shows a black background behind a transparent icon
      apple: withBasePath("/apple-touch-icon.png"),
    },
    // Added to an iPhone's home screen, Ronde opens like an app (and may then get push notifications)
    appleWebApp: { capable: true, title: "Ronde", statusBarStyle: "default" },
  };
}

/**
 * Before Umami sends a page view or an event: the address loses the names and ids it carries (workspace,
 * meeting, person, guest link…) and its query; the title, which names the meeting, becomes "Ronde"
 */
const UMAMI_BEFORE_SEND = `window.rondeBeforeSend=function(t,p){var c=function(u){if(!u)return u;try{var a=new URL(u,location.origin),
x=a.pathname.replace(/\\/w\\/[^/]+/,"/w/:workspace").replace(/\\/m\\/[^/]+/,"/m/:meeting").replace(/\\/(people|projects|g|invite|guest|calendar)\\/[^/]+/g,"/$1/:id");
if(a.origin!==location.origin)return a.origin;return /^https?:/.test(u)?a.origin+x:x}catch(e){return""}};p.url=c(p.url);if(p.referrer)p.referrer=c(p.referrer);p.title="Ronde";return p};`;

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // Light or dark when the user picked one; otherwise the device decides
  const theme = (await cookies()).get("ronde-theme")?.value;
  const sentry = env.sentryDsn();
  const umami = env.umami();
  const feedback = env.feedbackTo();
  return (
    <html lang={locale} dir={dirOf(resolveLocale(locale))} data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <head>
        {/* Optional error reports and audience measure, set up by the instance (see .env.example) */}
        {sentry && (
          <meta
            name="ronde-sentry"
            content={sentry}
            data-environment={env.sentryEnvironment()}
            data-release={process.env.RONDE_VERSION ?? ""}
          />
        )}
        {/* Who reads the "Send feedback" messages (the error page offers it too); absent: no button */}
        {feedback && <meta name="ronde-feedback" content={feedback} />}
        {umami.src && umami.websiteId && (
          <>
            <script dangerouslySetInnerHTML={{ __html: UMAMI_BEFORE_SEND }} />
            <script
              defer
              src={umami.src}
              data-website-id={umami.websiteId}
              data-domains={umami.domains || undefined}
              data-do-not-track="true"
              data-exclude-search="true"
              data-before-send="rondeBeforeSend"
            />
          </>
        )}
      </head>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
