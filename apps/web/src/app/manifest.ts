import type { MetadataRoute } from "next";
import { BASE_PATH } from "@/lib/shared/base-path";

// Ronde installed as an app (from the browser's menu, or "Add to Home Screen" on iPhone): its own window,
// its icon; the service worker (public/sw.js) brings the push notifications
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ronde",
    short_name: "Ronde",
    description: "Your team's recurring meetings: check-ins prepared ahead, a fair turn for everyone, minutes written for you.",
    id: `${BASE_PATH}/`,
    start_url: `${BASE_PATH}/`,
    scope: `${BASE_PATH}/`,
    display: "standalone",
    background_color: "#FBF6EC",
    theme_color: "#B53B0A",
    icons: [
      { src: `${BASE_PATH}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${BASE_PATH}/icon-orange.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      // Everything of the drawing sits within the safe circle: the same picture can be cut to any shape
      { src: `${BASE_PATH}/icon-orange.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
