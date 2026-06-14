/*
  Warnings:

  - A unique constraint covering the columns `[resetPasswordToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "resetPasswordExpiry" TIMESTAMP(3),
ADD COLUMN     "resetPasswordToken" TEXT;

-- CreateIndex
CREATE INDEX "Chat_hostAId_idx" ON "Chat"("hostAId");

-- CreateIndex
CREATE INDEX "Chat_hostBId_idx" ON "Chat"("hostBId");

-- CreateIndex
CREATE INDEX "Group_latitude_longitude_idx" ON "Group"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Group_publicProfile_isPartyMode_gender_idx" ON "Group"("publicProfile", "isPartyMode", "gender");

-- CreateIndex
CREATE INDEX "GroupLike_toGroupId_idx" ON "GroupLike"("toGroupId");

-- CreateIndex
CREATE INDEX "Message_chatId_createdAt_idx" ON "Message"("chatId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "User_resetPasswordToken_key" ON "User"("resetPasswordToken");
