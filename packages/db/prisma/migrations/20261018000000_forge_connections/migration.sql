-- GitLab and GitHub accounts become connections: the workspace's (trackers and every meeting) or a meeting's own
-- CreateEnum
CREATE TYPE "ForgeKind" AS ENUM ('gitlab', 'github');

-- AlterTable
ALTER TABLE "IssueTracker" ADD COLUMN     "connectionId" TEXT;

-- CreateTable
CREATE TABLE "ForgeConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meetingId" TEXT,
    "kind" "ForgeKind" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "account" TEXT NOT NULL DEFAULT '',
    "secret" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForgeConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForgeConnection_workspaceId_idx" ON "ForgeConnection"("workspaceId");

-- CreateIndex
CREATE INDEX "ForgeConnection_meetingId_idx" ON "ForgeConnection"("meetingId");

-- AddForeignKey
ALTER TABLE "ForgeConnection" ADD CONSTRAINT "ForgeConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeConnection" ADD CONSTRAINT "ForgeConnection_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "Meeting"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueTracker" ADD CONSTRAINT "IssueTracker_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ForgeConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A GitLab or GitHub tracker's server and token become a connection of the workspace, which the tracker uses
INSERT INTO "ForgeConnection" ("id", "workspaceId", "kind", "name", "url", "secret", "createdAt")
SELECT "id", "workspaceId", "kind"::text::"ForgeKind", "name",
       CASE WHEN "kind" = 'gitlab' THEN COALESCE(NULLIF(rtrim("config"->>'url', '/'), ''), 'https://gitlab.com') ELSE 'https://api.github.com' END,
       "secret", "createdAt"
FROM "IssueTracker" WHERE "kind" IN ('gitlab', 'github');
UPDATE "IssueTracker" SET "connectionId" = "id", "secret" = '', "config" = "config" - 'url' WHERE "kind" IN ('gitlab', 'github');

-- A meeting's own GitLab or GitHub token is not kept: the meeting now picks its connections
UPDATE "ModuleInstallation" SET "secret" = '', "config" = '{}' WHERE "moduleId" IN ('gitlab', 'github');
