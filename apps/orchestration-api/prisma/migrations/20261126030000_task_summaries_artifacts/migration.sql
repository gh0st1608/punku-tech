ALTER TABLE "tasks"
ADD COLUMN "summary" TEXT,
ADD COLUMN "artifact_paths_json" JSONB NOT NULL DEFAULT '[]';
