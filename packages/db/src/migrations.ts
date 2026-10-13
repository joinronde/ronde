/**
 * The newest migration of this version: the app serves only once the database has it (the migrate service runs
 * it). A test keeps it equal to the newest folder of prisma/migrations; update it with every new migration.
 */
export const LATEST_MIGRATION = "20261013100000_poll_yes_no";
