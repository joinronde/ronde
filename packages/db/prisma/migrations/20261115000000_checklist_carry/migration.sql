-- A checklist whose open items come back: the copy in the next check-in names the item it brings back, so the
-- stats count that item once
ALTER TABLE "CheckInItem" ADD COLUMN "carriedFromId" TEXT;

CREATE INDEX "CheckInItem_carriedFromId_idx" ON "CheckInItem"("carriedFromId");

ALTER TABLE "CheckInItem" ADD CONSTRAINT "CheckInItem_carriedFromId_fkey" FOREIGN KEY ("carriedFromId") REFERENCES "CheckInItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
