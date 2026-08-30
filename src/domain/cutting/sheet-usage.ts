import {
  addCanonicalDecimals,
  divideCanonicalDecimals,
  multiplyCanonicalDecimalByInteger,
  multiplyCanonicalDecimals,
  quantizeCanonicalDecimal,
  squareMillimetresToSquareMetres,
  subtractCanonicalDecimals,
} from "@/domain/calculation-decimal";

import type { CuttingInput, CuttingResult, CuttingSheet } from "./schema";

/**
 * 승인된 재단 결과를 원판 사용 실적으로 접는다(`D2-B06-A`·`D2-B06-B`).
 *
 * 원천은 승인된 개정 하나뿐이다. 여기서는 계산만 하고 저장은 서버가 맡는다.
 * 면적 단위는 ㎡, 길이는 mm 이며 모두 문자열 Decimal 이다(`D2-B03-B`).
 */

const AREA_SCALE = 8;
const PERCENT_SCALE = 2;

export type SheetUsageSummary = {
  /** 계약의 원판 후보 id. 지금은 원판 품목 id 그대로다. */
  sheetKey: string;
  label: string;
  widthMm: string;
  lengthMm: string;
  /** 쓴 장수. 같은 규격을 여러 장 썼으면 그 수만큼이다. */
  sheetCount: number;
  /** 쓴 장수 전체의 명목 면적. trim 을 빼지 않은 값이다. */
  totalAreaM2: string;
  /** 부품이 실제로 덮은 면적. */
  placedAreaM2: string;
  /**
   * 부품이 덮지 않은 면적 전부. trim·자투리·쓸 만한 크기로 남은 조각을 모두 포함한다.
   *
   * 남은 조각을 따로 세지 않는다(`D2-B06-H` 2026-08-30 (가)로 환원). 다시 쓰지
   * 않는 조각을 손실과 나눠 보이면 "이건 다음에 쓸 수 있다" 는 오해가 남는다.
   */
  lossAreaM2: string;
  /** 배치면적 ÷ 총면적. */
  yieldPercent: string;
};

export type SheetUsageBreakdown = {
  items: SheetUsageSummary[];
  totalSheetCount: number;
  totalAreaM2: string;
  placedAreaM2: string;
  lossAreaM2: string;
  yieldPercent: string;
};

function area(sheet: CuttingSheet): string {
  return squareMillimetresToSquareMetres(
    multiplyCanonicalDecimals(sheet.widthMm, sheet.lengthMm),
  );
}

function percent(numerator: string, denominator: string): string {
  if (denominator === "0") return "0";
  return quantizeCanonicalDecimal(
    multiplyCanonicalDecimalByInteger(divideCanonicalDecimals(numerator, denominator), 100),
    PERCENT_SCALE,
    "round",
  );
}

function quantizeArea(value: string): string {
  return quantizeCanonicalDecimal(value, AREA_SCALE, "round");
}

/**
 * 부품이 덮지 않은 면적을 손실로 본다. 음수가 나오면 0 으로 자른다.
 *
 * 반올림이 겹치면 배치면적이 총면적을 아주 조금 넘을 수 있다. 그때 손실을
 * 음수로 두면 화면에서 읽을 수 없는 값이 된다.
 */
function loss(total: string, placed: string): string {
  const rest = subtractCanonicalDecimals(total, placed);
  return rest.startsWith("-") ? "0" : rest;
}

/**
 * 원판 후보별로 접는다. 같은 원판을 여러 장 쓰면 한 줄로 합친다.
 *
 * 결과의 `sheets` 는 실제로 쓴 장만 담고 있으므로 장수는 그 개수를 센다.
 */
export function summarizeSheetUsage(
  input: CuttingInput,
  result: CuttingResult,
): SheetUsageBreakdown {
  const specs = new Map(input.sheets.map((sheet) => [sheet.sheetItemId, sheet]));
  const items = new Map<string, SheetUsageSummary>();

  for (const sheet of result.sheets) {
    const spec = specs.get(sheet.sheetItemId);
    if (!spec) {
      // 계약이 결과와 어긋난 것이라 계산을 이어 갈 수 없다.
      throw new Error(`재단 결과의 원판 ${sheet.sheetItemId} 가 입력에 없습니다.`);
    }

    const current = items.get(sheet.sheetItemId) ?? {
      sheetKey: spec.sheetItemId,
      label: spec.label,
      widthMm: spec.widthMm,
      lengthMm: spec.lengthMm,
      sheetCount: 0,
      totalAreaM2: "0",
      placedAreaM2: "0",
      lossAreaM2: "0",
      yieldPercent: "0",
    };

    current.sheetCount += 1;
    current.totalAreaM2 = addCanonicalDecimals(current.totalAreaM2, area(spec));
    current.placedAreaM2 = addCanonicalDecimals(current.placedAreaM2, sheet.usedAreaM2);
    items.set(sheet.sheetItemId, current);
  }

  let totalSheetCount = 0;
  let totalAreaM2 = "0";
  let placedAreaM2 = "0";

  for (const item of items.values()) {
    item.totalAreaM2 = quantizeArea(item.totalAreaM2);
    item.placedAreaM2 = quantizeArea(item.placedAreaM2);
    item.lossAreaM2 = quantizeArea(loss(item.totalAreaM2, item.placedAreaM2));
    item.yieldPercent = percent(item.placedAreaM2, item.totalAreaM2);

    totalSheetCount += item.sheetCount;
    totalAreaM2 = addCanonicalDecimals(totalAreaM2, item.totalAreaM2);
    placedAreaM2 = addCanonicalDecimals(placedAreaM2, item.placedAreaM2);
  }

  totalAreaM2 = quantizeArea(totalAreaM2);
  placedAreaM2 = quantizeArea(placedAreaM2);

  return {
    // 사람이 읽는 순서는 많이 쓴 원판부터다.
    items: [...items.values()].sort(
      (left, right) => right.sheetCount - left.sheetCount || left.label.localeCompare(right.label, "ko-KR"),
    ),
    totalSheetCount,
    totalAreaM2,
    placedAreaM2,
    lossAreaM2: quantizeArea(loss(totalAreaM2, placedAreaM2)),
    yieldPercent: percent(placedAreaM2, totalAreaM2),
  };
}

