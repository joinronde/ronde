import { Prisma, type PrismaClient } from "./generated/prisma/client";
import { isTenantModel } from "./tenancy";

/** A write tried to put a row in another workspace than the scope */
export class TenantViolation extends Error {
  constructor(model: string, expected: string, received: unknown) {
    super(`Tenant violation on ${model}: expected workspace ${expected}, got ${String(received)}`);
  }
}

const READS_AND_WRITES = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

/**
 * Client limited to one workspace. On every tenant model it adds `workspaceId` to the filters of reads,
 * updates and deletes, and sets it on creates (refusing another value). Rows of other workspaces are
 * therefore invisible: looking one up by id behaves as if it did not exist.
 */
export function scoped(base: PrismaClient, workspaceId: string) {
  const own = (model: string, data: unknown) => {
    if (!data || typeof data !== "object") return data;
    const row = data as Record<string, unknown>;
    if (row.workspaceId !== undefined && row.workspaceId !== workspaceId) throw new TenantViolation(model, workspaceId, row.workspaceId);
    if ("workspace" in row) throw new TenantViolation(model, workspaceId, "a nested workspace relation");
    return { ...row, workspaceId };
  };
  return base.$extends(
    Prisma.defineExtension({
      name: "ronde-tenant-scope",
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!isTenantModel(model)) return query(args);
            const a = { ...((args ?? {}) as Record<string, unknown>) };
            if (READS_AND_WRITES.has(operation)) a.where = { ...(a.where as object | undefined), workspaceId };
            if (operation === "create") a.data = own(model, a.data);
            if (operation === "createMany" || operation === "createManyAndReturn")
              a.data = Array.isArray(a.data) ? a.data.map((row) => own(model, row)) : own(model, a.data);
            if (operation === "upsert") {
              a.where = { ...(a.where as object | undefined), workspaceId };
              a.create = own(model, a.create);
              if (a.update && typeof a.update === "object" && "workspaceId" in (a.update as object))
                throw new TenantViolation(model, workspaceId, (a.update as Record<string, unknown>).workspaceId);
            }
            if ((operation === "update" || operation === "updateMany") && a.data && typeof a.data === "object" && "workspaceId" in a.data)
              throw new TenantViolation(model, workspaceId, (a.data as Record<string, unknown>).workspaceId);
            return query(a as typeof args);
          },
        },
      },
    }),
  );
}

export type ScopedClient = ReturnType<typeof scoped>;

/** Transaction of a scoped client: same tenant guarantees inside `db.$transaction(async (tx) => …)` */
export type ScopedTx = Parameters<Extract<Parameters<ScopedClient["$transaction"]>[0], (...args: never[]) => unknown>>[0];
