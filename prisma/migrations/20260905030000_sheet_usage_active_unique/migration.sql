-- 승인 취소 뒤 같은 개정을 다시 승인할 수 있게 한다.
--
-- `D2-B06-F` 는 승인을 취소해도 실적을 지우지 않고 무효로 남긴다. 그런데 유일 제약이
-- 상태를 가리지 않고 `(cuttingPlanRevisionId, sheetKey)` 한 줄만 허용해서, 무효가 된 줄이
-- 자리를 계속 차지했다. 그 결과 재승인이 항상 유일 제약 위반으로 실패했다.
--
-- 겹쳐 쓰기는 살아 있는 실적에만 막으면 된다. 무효 이력은 몇 겹이든 쌓여도 좋다.
ALTER TABLE "SheetUsageRecord" DROP CONSTRAINT "SheetUsageRecord_revision_sheet_key";

CREATE UNIQUE INDEX "SheetUsageRecord_one_active_per_revision_sheet_key"
  ON "SheetUsageRecord"("cuttingPlanRevisionId", "sheetKey")
  WHERE "status" = 'ACTIVE';

-- 개정별 조회는 유일 제약이 대신하고 있었다. 제약을 좁혔으니 일반 인덱스로 남긴다.
CREATE INDEX "SheetUsageRecord_revision_sheet_key"
  ON "SheetUsageRecord"("cuttingPlanRevisionId", "sheetKey");
