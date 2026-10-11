import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/server/auth";

// Better Auth endpoints: sign-up, sign-in (password, magic link, social, OIDC), sessions, two-factor…
export const { GET, POST } = toNextJsHandler(auth);
