-- Teams inside teams: a job category may belong to another one (a squad in a department)
ALTER TABLE "JobCategory" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "icon" TEXT NOT NULL DEFAULT '';

-- AddForeignKey
ALTER TABLE "JobCategory" ADD CONSTRAINT "JobCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "JobCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
