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

export type SheetUsageRemnant = {
  /** 이 잔재가 몇 번째 장에서 나왔는지. 사람이 찾을 때 쓴다. */
  sheetIndex: number;
  xMm: string;
  yMm: string;
  widthMm: string;
  lengthMm: string;
  areaM2: string;
};

export type SheetUsageSummary = {
  /** 계약의 원판 후보 id. 잔재를 후보로 실었으면 `remnant:<id>` 형태다. */
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
  /** 잔재로 남은 면적(`D2-B06-C` 판정을 넘은 것만). */
  remnantAreaM2: string;
  /** 나머지 전부. trim 과 자투리를 포함한다. */
  lossAreaM2: string;
  /** 배치면적 ÷ 총면적. */
  yieldPercent: string;
  remnants: SheetUsageRemnant[];
};

export type SheetUsageBreakdown = {
  items: SheetUsageSummary[];
  totalSheetCount: number;
  totalAreaM2: string;
  placedAreaM2: string;
  remnantAreaM2: string;
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
 * 남은 면적을 손실로 본다. 음수가 나오면 0 으로 자른다.
 *
 * solver 의 잔재는 배치 뒤 남은 빈 사각형이라 배치면적과 겹치지 않지만,
 * 반올림이 겹치면 총면적을 아주 조금 넘을 수 있다. 그때 손실을 음수로 두면
 * 화면에서 읽을 수 없는 값이 된다.
 */
function loss(total: string, placed: string, remnant: string): string {
  const rest = subtractCanonicalDecimals(subtractCanonicalDecimals(total, placed), remnant);
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
      remnantAreaM2: "0",
      lossAreaM2: "0",
      yieldPercent: "0",
      remnants: [],
    };

    const remnantArea = sheet.remnants.reduce(
      (total, remnant) => addCanonicalDecimals(total, remnant.areaM2),
      "0",
    );

    current.sheetCount += 1;
    current.totalAreaM2 = addCanonicalDecimals(current.totalAreaM2, area(spec));
    current.placedAreaM2 = addCanonicalDecimals(current.placedAreaM2, sheet.usedAreaM2);
    current.remnantAreaM2 = addCanonicalDecimals(current.remnantAreaM2, remnantArea);
    current.remnants.push(
      ...sheet.remnants.map((remnant) => ({ sheetIndex: sheet.sheetIndex, ...remnant })),
    );
    items.set(sheet.sheetItemId, current);
  }

  let totalSheetCount = 0;
  let totalAreaM2 = "0";
  let placedAreaM2 = "0";
  let remnantAreaM2 = "0";

  for (const item of items.values()) {
    item.totalAreaM2 = quantizeArea(item.totalAreaM2);
    item.placedAreaM2 = quantizeArea(item.placedAreaM2);
    item.remnantAreaM2 = quantizeArea(item.remnantAreaM2);
    item.lossAreaM2 = quantizeArea(loss(item.totalAreaM2, item.placedAreaM2, item.remnantAreaM2));
    item.yieldPercent = percent(item.placedAreaM2, item.totalAreaM2);

    totalSheetCount += item.sheetCount;
    totalAreaM2 = addCanonicalDecimals(totalAreaM2, item.totalAreaM2);
    placedAreaM2 = addCanonicalDecimals(placedAreaM2, item.placedAreaM2);
    remnantAreaM2 = addCanonicalDecimals(remnantAreaM2, item.remnantAreaM2);
  }

  totalAreaM2 = quantizeArea(totalAreaM2);
  placedAreaM2 = quantizeArea(placedAreaM2);
  remnantAreaM2 = quantizeArea(remnantAreaM2);

  return {
    // 사람이 읽는 순서는 많이 쓴 원판부터다.
    items: [...items.values()].sort(
      (left, right) => right.sheetCount - left.sheetCount || left.label.localeCompare(right.label, "ko-KR"),
    ),
    totalSheetCount,
    totalAreaM2,
    placedAreaM2,
    remnantAreaM2,
    lossAreaM2: quantizeArea(loss(totalAreaM2, placedAreaM2, remnantAreaM2)),
    yieldPercent: percent(placedAreaM2, totalAreaM2),
  };
}

/** 잔재 후보를 계약의 원판 id 로 옮길 때 쓰는 접두사. 계약은 고치지 않는다(`D2-B06-H`). */
export const REMNANT_SHEET_PREFIX = "remnant:" as const;

export function toRemnantSheetKey(remnantId: string): string {
  return `${REMNANT_SHEET_PREFIX}${remnantId}`;
}

/** 원판 후보 id 가 잔재를 가리키면 그 잔재 id 를, 아니면 `null` 을 준다. */
export function readRemnantId(sheetKey: string): string | null {
  return sheetKey.startsWith(REMNANT_SHEET_PREFIX)
    ? sheetKey.slice(REMNANT_SHEET_PREFIX.length)
    : null;
}
