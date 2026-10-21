-- Minutes written after the session: an archived session keeps its minutes as a draft until a host publishes them
ALTER TABLE "Session" ADD COLUMN "minutesPublishedAt" TIMESTAMP(3),
ADD COLUMN "draftRemindedAt" TIMESTAMP(3);

-- The minutes of the sessions archived so far went out with the archive
UPDATE "Session" SET "minutesPublishedAt" = "archivedAt" WHERE "status" = 'archived';
