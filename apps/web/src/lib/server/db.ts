import "server-only";

// The database client lives in @ronde/db; this module keeps the server-only guard for the app.
export { prisma, scoped } from "@ronde/db";
