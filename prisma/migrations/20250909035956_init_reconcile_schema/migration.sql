-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "reconcile";

-- CreateTable
CREATE TABLE "reconcile"."Dataset" (
    "id" TEXT NOT NULL,
    "deptCode" TEXT NOT NULL,
    "subjectCode" TEXT NOT NULL,
    "ym" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconcile"."ImportJob" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconcile"."Entry" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "partnerCode" TEXT NOT NULL,
    "partnerName" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "debit" BIGINT NOT NULL DEFAULT 0,
    "credit" BIGINT NOT NULL DEFAULT 0,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "softDeletedAt" TIMESTAMP(3),
    "importJobId" TEXT,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconcile"."Project" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderNo" INTEGER NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconcile"."ProjectEntry" (
    "projectId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEntry_pkey" PRIMARY KEY ("projectId","entryId")
);

-- CreateIndex
CREATE INDEX "Dataset_ym_deptCode_subjectCode_idx" ON "reconcile"."Dataset"("ym", "deptCode", "subjectCode");

-- CreateIndex
CREATE UNIQUE INDEX "Dataset_deptCode_subjectCode_ym_key" ON "reconcile"."Dataset"("deptCode", "subjectCode", "ym");

-- CreateIndex
CREATE INDEX "ImportJob_datasetId_createdAt_idx" ON "reconcile"."ImportJob"("datasetId", "createdAt");

-- CreateIndex
CREATE INDEX "Entry_datasetId_softDeletedAt_idx" ON "reconcile"."Entry"("datasetId", "softDeletedAt");

-- CreateIndex
CREATE INDEX "Entry_datasetId_date_voucherNo_idx" ON "reconcile"."Entry"("datasetId", "date", "voucherNo");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_datasetId_rowKey_key" ON "reconcile"."Entry"("datasetId", "rowKey");

-- CreateIndex
CREATE INDEX "Project_datasetId_isDeleted_orderNo_idx" ON "reconcile"."Project"("datasetId", "isDeleted", "orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEntry_entryId_key" ON "reconcile"."ProjectEntry"("entryId");

-- CreateIndex
CREATE INDEX "ProjectEntry_projectId_idx" ON "reconcile"."ProjectEntry"("projectId");

-- AddForeignKey
ALTER TABLE "reconcile"."ImportJob" ADD CONSTRAINT "ImportJob_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "reconcile"."Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconcile"."Entry" ADD CONSTRAINT "Entry_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "reconcile"."Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconcile"."Entry" ADD CONSTRAINT "Entry_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "reconcile"."ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconcile"."Project" ADD CONSTRAINT "Project_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "reconcile"."Dataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconcile"."ProjectEntry" ADD CONSTRAINT "ProjectEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "reconcile"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconcile"."ProjectEntry" ADD CONSTRAINT "ProjectEntry_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "reconcile"."Entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
