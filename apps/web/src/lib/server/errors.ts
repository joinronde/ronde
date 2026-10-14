import "server-only";
import { OpError as BaseOpError } from "@ronde/module-sdk";

// User-facing errors live in the module SDK, so modules throw the same ones as the app
export { AccessError, AppError, type ErrorKey, type ErrorValues, IntegrationError, OpError } from "@ronde/module-sdk";

/**
 * Input of an operation refused by its schema: an "invalid request" like any other for the code that catches it,
 * whose details are said in the reader's language when the answer is written (lib/server/issues.ts)
 */
export class InputError extends BaseOpError {
  constructor(public issues: readonly { code: string; origin?: string; minimum?: number | bigint; maximum?: number | bigint }[]) {
    super("invalidRequest", { details: "" });
  }
}
