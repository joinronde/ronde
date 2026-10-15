-- Where a follow-up action stands: one sentence from its owner on what was tried, and when it was written
ALTER TABLE "Action" ADD COLUMN     "progress" TEXT,
ADD COLUMN     "progressAt" TIMESTAMP(3);
