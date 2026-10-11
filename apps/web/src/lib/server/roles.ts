import "server-only";
import { hasFeature } from "@ronde/editions";
import { featureOn, type PlanScope, readEditionOf } from "./license";

/** Custom roles can be created and given (Enterprise license in force) */
export const customRolesOn = (ws: PlanScope) => featureOn("permissions.customRoles", ws);
/** Custom roles can be seen (an expired license keeps them visible, without effect) */
export const customRolesReadable = (ws: PlanScope) => hasFeature(readEditionOf(ws), "permissions.customRoles");
