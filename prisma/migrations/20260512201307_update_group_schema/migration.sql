/*
  Warnings:

  - You are about to drop the column `groupGender` on the `Group` table. All the data in the column will be lost.
  - You are about to drop the column `groupType` on the `Group` table. All the data in the column will be lost.
  - You are about to drop the column `hostId` on the `Group` table. All the data in the column will be lost.
  - You are about to drop the column `hostName` on the `Group` table. All the data in the column will be lost.
  - You are about to drop the column `images` on the `Group` table. All the data in the column will be lost.
  - You are about to drop the column `instaLink` on the `Group` table. All the data in the column will be lost.
  - You are about to drop the column `instagramHandles` on the `Group` table. All the data in the column will be lost.
  - You are about to drop the column `interactions` on the `Group` table. All the data in the column will be lost.
  - You are about to drop the column `latitude` on the `Group` table. All the data in the column will be lost.
  - You are about to drop the column `longitude` on the `Group` table. All the data in the column will be lost.
  - You are about to drop the column `searchAgeMin` on the `Group` table. All the data in the column will be lost.
  - You are about to drop the column `seekingGender` on the `Group` table. All the data in the column will be lost.
  - You are about to drop the column `views` on the `Group` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId]` on the table `Group` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `Group` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Group" DROP CONSTRAINT "Group_hostId_fkey";

-- DropIndex
DROP INDEX "Group_hostId_key";

-- AlterTable
ALTER TABLE "Group" DROP COLUMN "groupGender",
DROP COLUMN "groupType",
DROP COLUMN "hostId",
DROP COLUMN "hostName",
DROP COLUMN "images",
DROP COLUMN "instaLink",
DROP COLUMN "instagramHandles",
DROP COLUMN "interactions",
DROP COLUMN "latitude",
DROP COLUMN "longitude",
DROP COLUMN "searchAgeMin",
DROP COLUMN "seekingGender",
DROP COLUMN "views",
ADD COLUMN     "gender" TEXT NOT NULL DEFAULT 'ANY',
ADD COLUMN     "instagram" TEXT[],
ADD COLUMN     "maxDistance" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "photos" TEXT[],
ADD COLUMN     "searchGender" TEXT NOT NULL DEFAULT 'ANY',
ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Group_userId_key" ON "Group"("userId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;