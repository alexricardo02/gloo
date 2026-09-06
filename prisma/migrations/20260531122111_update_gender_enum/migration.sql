/*
  Warnings:

  - The values [OTHER,ANY] on the enum `Gender` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Gender_new" AS ENUM ('MALE', 'FEMALE', 'MIXED', 'DIVERSE');
ALTER TABLE "public"."Group" ALTER COLUMN "gender" DROP DEFAULT;
ALTER TABLE "public"."Group" ALTER COLUMN "searchGender" DROP DEFAULT;
ALTER TABLE "Group" ALTER COLUMN "gender" TYPE "Gender_new" USING ("gender"::text::"Gender_new");
ALTER TABLE "Group" ALTER COLUMN "searchGender" TYPE "Gender_new" USING ("searchGender"::text::"Gender_new");
ALTER TYPE "Gender" RENAME TO "Gender_old";
ALTER TYPE "Gender_new" RENAME TO "Gender";
DROP TYPE "public"."Gender_old";
ALTER TABLE "Group" ALTER COLUMN "gender" SET DEFAULT 'MIXED';
ALTER TABLE "Group" ALTER COLUMN "searchGender" SET DEFAULT 'MIXED';
COMMIT;

-- AlterTable
ALTER TABLE "Group" ALTER COLUMN "gender" SET DEFAULT 'MIXED',
ALTER COLUMN "searchGender" SET DEFAULT 'MIXED';
