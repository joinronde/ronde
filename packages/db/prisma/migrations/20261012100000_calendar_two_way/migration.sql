-- AlterEnum
ALTER TYPE "CalendarKind" ADD VALUE 'caldav';

-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "answers" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "endsAt" TIMESTAMP(3);
