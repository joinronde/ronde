-- A quick yes or no poll, told apart without reading its options (they are written in the host's language)
ALTER TABLE "Poll" ADD COLUMN     "yesNo" BOOLEAN NOT NULL DEFAULT false;
