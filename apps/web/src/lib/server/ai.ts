import "server-only";
import type { AiConfig } from "@ronde/editions/ee";
import type { WorkspaceSettings } from "./authz";
import { env } from "./env";
import { featureOn, type PlanScope } from "./license";
import { decryptSecret } from "./secrets";

// The AI assistant (Team): the provider account a workspace uses, its own key or the instance's

export const aiOn = (ws: PlanScope) => featureOn("modules.aiAssistant", ws);

/** Models offered, the most capable first; the default balances quality and cost */
export const AI_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"] as const;
export const DEFAULT_AI_MODEL = AI_MODELS[0];

/** Whether the instance provides a key to every workspace */
export const instanceAiKey = () => !!env.anthropicKey();

/** The account to call, or null when the assistant is off, not in the plan, or has no key */
export function aiConfig(settings: WorkspaceSettings, ws: PlanScope): AiConfig | null {
  const ai = settings.ai;
  if (!aiOn(ws) || !ai?.enabled) return null;
  let apiKey = env.anthropicKey();
  if (ai.key) {
    try {
      apiKey = decryptSecret(ai.key);
    } catch {
      return null;
    }
  }
  if (!apiKey) return null;
  return { apiKey, model: (AI_MODELS as readonly string[]).includes(ai.model) ? ai.model : DEFAULT_AI_MODEL };
}
