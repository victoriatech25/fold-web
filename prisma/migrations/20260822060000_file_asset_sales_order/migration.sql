-- 수주 첨부 파일을 수주에 연결한다. 서버 생성물은 이 값이 비어 있다.
ALTER TABLE "FileAsset" ADD COLUMN "salesOrderId" UUID;

ALTER TABLE "FileAsset"
  ADD CONSTRAINT "FileAsset_salesOrderId_fkey"
  FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "FileAsset_organizationId_salesOrderId_status_idx"
  ON "FileAsset"("organizationId", "salesOrderId", "status");
