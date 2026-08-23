import "server-only";

import { createHash } from "node:crypto";

import {
  CUTTING_CONTRACT_VERSION,
  cuttingInputSchema,
  type CuttingInput,
  type CuttingPart,
  type CuttingSheet,
} from "@/domain/cutting/schema";
import { calculateFoldProfileDocument } from "@/domain/fold-calculation";
import { FoldDocumentValidationError } from "@/domain/fold-document/errors";
import { projectCanonicalJsonV1 } from "@/domain/fold-document/canonical";
import { serverDocumentToBrowserFoldProfileV4 } from "@/domain/fold-document/adapter";
import { readFoldRevisionDocument } from "@/server/fold-document/revision-contract";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { CuttingError } from "./cutting-error";

type Database = PrismaClient | Prisma.TransactionClient;

/**
 * 재단 입력을 만들 때 쓰는 수주 항목. 계산 서비스와 같은 자리에서 읽는다.
 */
const foldItemSelect = {
  id: true,
  lineNumber: true,
  name: true,
  quantity: true,
  documentSchemaVersion: true,
  document: true,
  documentChecksumSha256: true,
  materialRuleRevisionId: true,
  createdAt: true,
  updatedAt: true,
  materialRuleRevision: { select: { materialVariantId: true } },
} as const satisfies Prisma.SalesOrderFoldItemSelect;

const sheetItemSelect = {
  id: true,
  code: true,
  name: true,
  widthMm: true,
  lengthMm: true,
  trimTopMm: true,
  trimRightMm: true,
  trimBottomMm: true,
  trimLeftMm: true,
  rotationPolicy: true,
  grainAxis: true,
  minRemnantWidthMm: true,
  minRemnantLengthMm: true,
  minRemnantAreaM2: true,
} as const satisfies Prisma.SheetItemSelect;

function decimal(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

/**
 * 기준정보의 `KEEP_GRAIN` 을 계약의 회전 정책으로 옮긴다.
 *
 * `SheetItem.rotationPolicy` 는 `FREE | KEEP_GRAIN` 이고 계약은 `FREE | FIXED` 라
 * 값이 그대로 맞지 않는다(`P2-B03` 의 `D2-B03-E` 기록 보정 대상).
 * 지킬 결이 없으면 돌려도 잃을 것이 없으므로 `FREE` 로 본다.
 */
function toRotationPolicy(
  row: Pick<Prisma.SheetItemGetPayload<{ select: typeof sheetItemSelect }>, "rotationPolicy" | "grainAxis">,
): "FREE" | "FIXED" {
  if (row.rotationPolicy === "FREE") return "FREE";
  return row.grainAxis === "NONE" ? "FREE" : "FIXED";
}

function toSheet(row: Prisma.SheetItemGetPayload<{ select: typeof sheetItemSelect }>): CuttingSheet {
  return {
    sheetItemId: row.id,
    label: `${row.code} ${row.name}`.trim(),
    widthMm: row.widthMm.toString(),
    lengthMm: row.lengthMm.toString(),
    trimTopMm: row.trimTopMm.toString(),
    trimRightMm: row.trimRightMm.toString(),
    trimBottomMm: row.trimBottomMm.toString(),
    trimLeftMm: row.trimLeftMm.toString(),
    rotationPolicy: toRotationPolicy(row),
    grainAxis: row.grainAxis,
    minRemnantWidthMm: decimal(row.minRemnantWidthMm),
    minRemnantLengthMm: decimal(row.minRemnantLengthMm),
    minRemnantAreaM2: decimal(row.minRemnantAreaM2),
    // 재고 연동은 `P2-B06` 범위다. 지금은 장수 제한을 두지 않는다.
    availableCount: null,
  };
}

/**
 * 수주 항목 하나를 재단 부품 하나로 바꾼다(`D2-B05-B`).
 *
 * 부품 치수는 전개 폭 × 제품 길이다. 계산 스냅샷의 `metrics` 는 면적만 담고 있어
 * 직사각형 치수를 알 수 없으므로, 불변 복사된 항목 문서에서 다시 계산한다.
 * 문서가 불변이라 언제 계산해도 같은 값이 나온다.
 */
function toPart(
  item: Prisma.SalesOrderFoldItemGetPayload<{ select: typeof foldItemSelect }>,
): CuttingPart {
  let size: { width: string; length: string };
  try {
    const document = readFoldRevisionDocument(item);
    const profile = serverDocumentToBrowserFoldProfileV4(JSON.parse(JSON.stringify(document)), {
      id: item.id,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    });
    size = calculateFoldProfileDocument(profile).sizeDecimal;
  } catch (error) {
    if (error instanceof FoldDocumentValidationError) {
      throw new CuttingError(
        "INVALID_REQUEST",
        `작업 ${item.lineNumber}의 전개 치수를 계산할 수 없습니다. ${error.message}`,
      );
    }
    throw error;
  }

  return {
    id: item.id,
    label: `${item.lineNumber}. ${item.name}`,
    widthMm: size.width,
    lengthMm: size.length,
    quantity: item.quantity,
    // 전개 직사각형은 결이 없는 재질에서 돌려 놓아도 된다. 결 제약은 원판이 건다.
    rotationAllowed: true,
    grainDirection: "NONE",
  };
}

export type CuttingInputBuildResult = {
  materialVariantId: string;
  input: CuttingInput;
  inputChecksumSha256: string;
};

/**
 * 승인된 수주에서 재질 변형별 재단 입력을 만든다(`D2-B05-A`·`D2-B05-I`).
 * 재질이 셋이면 재단 작업도 셋이 된다.
 */
export async function buildCuttingInputs(
  database: Database,
  options: { organizationId: string; salesOrderId: string; bladeKerfMm?: string },
): Promise<CuttingInputBuildResult[]> {
  const items = await database.salesOrderFoldItem.findMany({
    where: {
      organizationId: options.organizationId,
      salesOrderId: options.salesOrderId,
      removedAt: null,
    },
    select: foldItemSelect,
    orderBy: { lineNumber: "asc" },
  });
  if (items.length === 0) {
    throw new CuttingError("INVALID_REQUEST", "재단할 절곡 작업이 없습니다.");
  }

  const byVariant = new Map<string, typeof items>();
  for (const item of items) {
    const variantId = item.materialRuleRevision.materialVariantId;
    byVariant.set(variantId, [...(byVariant.get(variantId) ?? []), item]);
  }

  const results: CuttingInputBuildResult[] = [];
  for (const [materialVariantId, variantItems] of byVariant) {
    const sheetRows = await database.sheetItem.findMany({
      where: {
        organizationId: options.organizationId,
        materialVariantId,
        active: true,
        deletedAt: null,
      },
      select: sheetItemSelect,
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { code: "asc" }],
    });
    if (sheetRows.length === 0) {
      throw new CuttingError(
        "INVALID_REQUEST",
        "이 재질에 쓸 수 있는 원판이 없습니다. 기준정보에서 원판을 먼저 등록해 주세요.",
      );
    }

    const input = cuttingInputSchema.parse({
      contractVersion: CUTTING_CONTRACT_VERSION,
      parts: variantItems.map(toPart),
      sheets: sheetRows.map(toSheet),
      options: {
        // 실제 칼날 두께는 현장 확인이 남아 있다(`D2-B04-K`).
        bladeKerfMm: options.bladeKerfMm ?? "0",
        objective: "SHEET_COUNT_FIRST",
        seed: null,
      },
    });

    results.push({
      materialVariantId,
      input,
      inputChecksumSha256: createHash("sha256")
        .update(projectCanonicalJsonV1(input), "utf8")
        .digest("hex"),
    });
  }

  return results;
}
