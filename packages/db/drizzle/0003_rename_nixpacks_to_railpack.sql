-- Custom SQL migration file, put your code below! --
UPDATE "projects" SET "build_mode" = 'railpack' WHERE "build_mode" = 'nixpacks';
UPDATE "deployments" SET "build_mode" = 'railpack' WHERE "build_mode" = 'nixpacks';