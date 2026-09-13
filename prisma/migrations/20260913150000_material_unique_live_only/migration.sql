-- 삭제(숨김)한 재질·두께의 코드와 이름을 다시 쓸 수 있게 한다.
--
-- 재질 삭제는 `deletedAt` 을 찍는 숨김이다(`D2-A03-I`). 그런데 코드·이름 고유 제약이 삭제
-- 여부를 가리지 않아, 사용자는 지웠다고 생각하는 재질이 같은 코드의 재등록을 막았다.
-- 고유는 살아 있는 행에만 걸면 된다. `FoldTemplate`·`SheetUsageRecord` 와 같은 방식이다.

DROP INDEX "Material_organizationId_code_key";
DROP INDEX "Material_organizationId_normalizedName_key";
DROP INDEX "MaterialVariant_organizationId_code_key";

CREATE UNIQUE INDEX "Material_one_live_per_code"
  ON "Material"("organizationId", "code")
  WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Material_one_live_per_name"
  ON "Material"("organizationId", "normalizedName")
  WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "MaterialVariant_one_live_per_code"
  ON "MaterialVariant"("organizationId", "code")
  WHERE "deletedAt" IS NULL;

-- 조회는 고유 인덱스가 대신하고 있었다. 제약을 좁혔으니 일반 인덱스로 남긴다.
CREATE INDEX "Material_organizationId_code_idx" ON "Material"("organizationId", "code");
CREATE INDEX "Material_organizationId_normalizedName_idx" ON "Material"("organizationId", "normalizedName");
CREATE INDEX "MaterialVariant_organizationId_code_idx" ON "MaterialVariant"("organizationId", "code");
