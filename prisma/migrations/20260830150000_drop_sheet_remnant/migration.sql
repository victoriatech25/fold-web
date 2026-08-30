-- 잔재를 개체로 남기지 않는다(`D2-B06-H` 2026-08-30 (가)로 환원).
-- 현장에서 남은 원판을 다시 쓰지 않는다는 것이 확인됐다. 쓰지 않는 것을 세면
-- 틀린 숫자만 쌓이고, 없는 조각을 깔고 앉은 재단 계획이 나온다.
DROP TABLE IF EXISTS "SheetRemnant";
DROP TYPE IF EXISTS "SheetRemnantStatus";

-- 잔재 면적은 손실에 합친다. 다시 쓰지 않는 조각을 손실과 나눠 보이면
-- "이건 다음에 쓸 수 있다" 는 오해가 남는다.
UPDATE "SheetUsageRecord"
SET "lossAreaM2" = "lossAreaM2" + "remnantAreaM2"
WHERE "remnantAreaM2" > 0;

ALTER TABLE "SheetUsageRecord" DROP COLUMN "remnantAreaM2";
ALTER TABLE "SheetUsageRecord" DROP COLUMN "sourceRemnantId";

-- 컬럼을 지우면 그 컬럼을 보던 검사도 함께 사라진다. 없을 수도 있으므로 IF EXISTS 다.
ALTER TABLE "SheetUsageRecord" DROP CONSTRAINT IF EXISTS "SheetUsageRecord_area_check";
ALTER TABLE "SheetUsageRecord" ADD CONSTRAINT "SheetUsageRecord_area_check" CHECK (
  "totalAreaM2" >= 0 AND "placedAreaM2" >= 0 AND "lossAreaM2" >= 0
);
