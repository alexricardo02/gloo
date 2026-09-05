/*
  Warnings:

  - You are about to drop the column `publicProfile` on the `Group` table. All the data in the column will be lost.
  - The `gender` column on the `Group` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `searchGender` column on the `Group` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Group" DROP COLUMN "publicProfile",
ADD COLUMN     "isPartyMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ALTER COLUMN "description" SET DATA TYPE TEXT,
DROP COLUMN "gender",
ADD COLUMN     "gender" "Gender" NOT NULL DEFAULT 'ANY',
DROP COLUMN "searchGender",
ADD COLUMN     "searchGender" "Gender" NOT NULL DEFAULT 'ANY';

-- CreateTable
CREATE TABLE "GroupLike" (
    "id" TEXT NOT NULL,
    "fromGroupId" TEXT NOT NULL,
    "toGroupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupLike_fromGroupId_toGroupId_key" ON "GroupLike"("fromGroupId", "toGroupId");

-- AddForeignKey
ALTER TABLE "GroupLike" ADD CONSTRAINT "GroupLike_fromGroupId_fkey" FOREIGN KEY ("fromGroupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupLike" ADD CONSTRAINT "GroupLike_toGroupId_fkey" FOREIGN KEY ("toGroupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
