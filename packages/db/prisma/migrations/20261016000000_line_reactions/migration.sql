-- Reactions on a line of a check-in: an emoji each, not only 👍
ALTER TABLE "CheckInComment" ADD COLUMN     "emoji" TEXT NOT NULL DEFAULT '';
