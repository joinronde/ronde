-- Slides of the agenda: what people post on them (irritants…), and the step an action was decided at
-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "originStep" TEXT;

-- CreateTable
CREATE TABLE "SlideItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "actionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlideItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlideItem_sessionId_blockId_idx" ON "SlideItem"("sessionId", "blockId");

-- CreateIndex
CREATE INDEX "SlideItem_actionId_idx" ON "SlideItem"("actionId");

-- CreateIndex
CREATE INDEX "SlideItem_workspaceId_idx" ON "SlideItem"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SlideItem_id_workspaceId_key" ON "SlideItem"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "SlideItem" ADD CONSTRAINT "SlideItem_sessionId_workspaceId_fkey" FOREIGN KEY ("sessionId", "workspaceId") REFERENCES "Session"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlideItem" ADD CONSTRAINT "SlideItem_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;
