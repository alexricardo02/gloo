-- CreateTable
CREATE TABLE "GroupBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedGroupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupReport" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedGroupId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupBlock_blockerId_blockedGroupId_key" ON "GroupBlock"("blockerId", "blockedGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupReport_reporterId_reportedGroupId_key" ON "GroupReport"("reporterId", "reportedGroupId");

-- AddForeignKey
ALTER TABLE "GroupBlock" ADD CONSTRAINT "GroupBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupBlock" ADD CONSTRAINT "GroupBlock_blockedGroupId_fkey" FOREIGN KEY ("blockedGroupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupReport" ADD CONSTRAINT "GroupReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupReport" ADD CONSTRAINT "GroupReport_reportedGroupId_fkey" FOREIGN KEY ("reportedGroupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
