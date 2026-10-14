-- Who adds projects for a meeting to follow: its hosts (as until now) or every participant
ALTER TABLE "Meeting" ADD COLUMN     "projectsBy" TEXT NOT NULL DEFAULT 'hosts';
