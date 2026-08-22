import {
  CUTTING_CONTRACT_VERSION,
  type CuttingInput,
  type CuttingPart,
  type CuttingPlacement,
  type CuttingResult,
  type CuttingSheet,
} from "@/domain/cutting/schema";

export type CuttingViolationCode =
  | "CONTRACT_VERSION_MISMATCH"
  | "UNKNOWN_PART"
  | "UNKNOWN_SHEET"
  | "QUANTITY_MISMATCH"
  | "OUT_OF_USABLE_AREA"
  | "OVERLAP"
  | "KERF_NOT_KEPT"
  | "ROTATION_NOT_ALLOWED"
  | "GRAIN_CONFLICT"
  | "REMNANT_TOO_SMALL"
  | "REMNANT_OVERLAP"
  | "SHEET_LIMIT_EXCEEDED"
  | "NOT_GUILLOTINE"
  | "AREA_MISMATCH";

export type CuttingViolation = {
  code: CuttingViolationCode;
  message: string;
  sheetIndex?: number;
  partId?: string;
};

const ZERO = BigInt(0);
// 내부 길이 단위는 mm 의 1/10^6 이다. Decimal 정책의 소수 6자리가 그대로 담긴다.
const AREA_SCALE = BigInt(100_000_000);
// 1㎡ = 10^6 ㎟ = 10^6 × (10^6)^2 내부 단위² = 10^18.
const SQUARE_UNITS_PER_SQUARE_METRE = BigInt(10) ** BigInt(18);

/**
 * 길이를 내부 정수 단위로 바꾼다.
 * 기하 검사에서 부동소수를 쓰면 경계에서 판정이 흔들린다(`D2-B03-B`).
 */
function toUnits(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ""] = unsigned.split(".");
  const scaled = BigInt(`${integer}${fraction.padEnd(6, "0").slice(0, 6)}`);
  return negative ? -scaled : scaled;
}

/** 내부 단위 넓이를 ㎡ 문자열로 바꾼다. 소수 8자리까지 남긴다. */
function squareUnitsToM2(value: bigint): string {
  const scaled = (value * AREA_SCALE) / SQUARE_UNITS_PER_SQUARE_METRE;
  const integer = scaled / AREA_SCALE;
  const fraction = (scaled % AREA_SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : `${integer}`;
}

type Rect = { x: bigint; y: bigint; width: bigint; height: bigint };

function placedRect(part: CuttingPart, placement: CuttingPlacement): Rect {
  const width = toUnits(part.widthMm);
  const length = toUnits(part.lengthMm);
  return {
    x: toUnits(placement.xMm),
    y: toUnits(placement.yMm),
    width: placement.rotated ? length : width,
    height: placement.rotated ? width : length,
  };
}

function usableArea(sheet: CuttingSheet): Rect {
  const left = toUnits(sheet.trimLeftMm);
  const bottom = toUnits(sheet.trimBottomMm);
  return {
    x: left,
    y: bottom,
    width: toUnits(sheet.widthMm) - left - toUnits(sheet.trimRightMm),
    height: toUnits(sheet.lengthMm) - bottom - toUnits(sheet.trimTopMm),
  };
}

/** 두 사각형이 겹치는지. 맞닿기만 하는 것은 겹침이 아니다. */
function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/** 두 사각형 사이에 적어도 한 축에서 kerf 만큼 벌어져 있는지(`D2-B03-F`). */
function keepsKerf(a: Rect, b: Rect, kerf: bigint): boolean {
  if (kerf === ZERO) return true;
  const gapX = a.x >= b.x + b.width ? a.x - (b.x + b.width) : b.x - (a.x + a.width);
  const gapY = a.y >= b.y + b.height ? a.y - (b.y + b.height) : b.y - (a.y + a.height);
  return gapX >= kerf || gapY >= kerf;
}

/**
 * 직선 관통 절단만으로 이 배치를 만들 수 있는지 본다(`D2-B03-J`).
 * 영역을 끝에서 끝까지 가르는 선을 찾아 재귀로 쪼갠다. 어디서도 못 가르면
 * 현장 장비로 자를 수 없는 배치다.
 */
function isGuillotine(rects: Rect[]): boolean {
  if (rects.length <= 1) return true;

  for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    const candidates = new Set(rects.map((rect) => rect[axis] + rect[size]));
    for (const line of candidates) {
      const straddles = rects.some(
        (rect) => rect[axis] < line && line < rect[axis] + rect[size],
      );
      if (straddles) continue;
      const before = rects.filter((rect) => rect[axis] + rect[size] <= line);
      const after = rects.filter((rect) => rect[axis] >= line);
      if (before.length === 0 || after.length === 0) continue;
      if (isGuillotine(before) && isGuillotine(after)) return true;
    }
  }
  return false;
}

/** 놓인 방향에서 부품의 결이 향하는 축. */
function placedGrain(part: CuttingPart, rotated: boolean) {
  if (part.grainDirection === "NONE") return "NONE";
  if (!rotated) return part.grainDirection;
  return part.grainDirection === "WIDTH" ? "LENGTH" : "WIDTH";
}

/**
 * solver 가 무엇을 만들었든 이 검사를 통과해야 한다(`D2-B03-N`).
 * `P2-B04` 는 이 함수를 기준으로 개발하고, 화면 승인도 이 결과를 근거로 한다.
 */
export function validateCuttingResult(
  input: CuttingInput,
  result: CuttingResult,
): CuttingViolation[] {
  const violations: CuttingViolation[] = [];
  const add = (violation: CuttingViolation) => violations.push(violation);

  if (result.contractVersion !== CUTTING_CONTRACT_VERSION) {
    add({
      code: "CONTRACT_VERSION_MISMATCH",
      message: `계약 버전이 ${CUTTING_CONTRACT_VERSION}이 아닙니다.`,
    });
    return violations;
  }

  const partsById = new Map(input.parts.map((part) => [part.id, part]));
  const sheetsById = new Map(input.sheets.map((sheet) => [sheet.sheetItemId, sheet]));
  const kerf = toUnits(input.options.bladeKerfMm);
  const placedCount = new Map<string, number>();
  const sheetUsage = new Map<string, number>();

  for (const sheetResult of result.sheets) {
    const sheet = sheetsById.get(sheetResult.sheetItemId);
    if (!sheet) {
      add({
        code: "UNKNOWN_SHEET",
        message: `입력에 없는 원판 ${sheetResult.sheetItemId}을 사용했습니다.`,
        sheetIndex: sheetResult.sheetIndex,
      });
      continue;
    }
    sheetUsage.set(sheet.sheetItemId, (sheetUsage.get(sheet.sheetItemId) ?? 0) + 1);

    const usable = usableArea(sheet);
    const rects: Rect[] = [];

    for (const placement of sheetResult.placements) {
      const part = partsById.get(placement.partId);
      if (!part) {
        add({
          code: "UNKNOWN_PART",
          message: `입력에 없는 부품 ${placement.partId}을 배치했습니다.`,
          sheetIndex: sheetResult.sheetIndex,
          partId: placement.partId,
        });
        continue;
      }
      placedCount.set(part.id, (placedCount.get(part.id) ?? 0) + 1);

      if (placement.rotated && (!part.rotationAllowed || sheet.rotationPolicy === "FIXED")) {
        add({
          code: "ROTATION_NOT_ALLOWED",
          message: `${part.label}은 이 원판에서 회전 배치할 수 없습니다.`,
          sheetIndex: sheetResult.sheetIndex,
          partId: part.id,
        });
      }

      const grain = placedGrain(part, placement.rotated);
      if (sheet.grainAxis !== "NONE" && grain !== "NONE" && grain !== sheet.grainAxis) {
        add({
          code: "GRAIN_CONFLICT",
          message: `${part.label}의 결 방향이 원판 결과 어긋납니다.`,
          sheetIndex: sheetResult.sheetIndex,
          partId: part.id,
        });
      }

      const rect = placedRect(part, placement);
      const insideX = rect.x >= usable.x && rect.x + rect.width <= usable.x + usable.width;
      const insideY = rect.y >= usable.y && rect.y + rect.height <= usable.y + usable.height;
      if (!insideX || !insideY) {
        add({
          code: "OUT_OF_USABLE_AREA",
          message: `${part.label}이 trim을 뺀 사용 영역을 벗어났습니다.`,
          sheetIndex: sheetResult.sheetIndex,
          partId: part.id,
        });
      }

      for (const other of rects) {
        if (overlaps(rect, other)) {
          add({
            code: "OVERLAP",
            message: `${part.label}이 다른 부품과 겹칩니다.`,
            sheetIndex: sheetResult.sheetIndex,
            partId: part.id,
          });
        } else if (!keepsKerf(rect, other, kerf)) {
          add({
            code: "KERF_NOT_KEPT",
            message: `${part.label}과 이웃 부품 사이에 칼날 두께가 확보되지 않았습니다.`,
            sheetIndex: sheetResult.sheetIndex,
            partId: part.id,
          });
        }
      }
      rects.push(rect);
    }

    for (const remnant of sheetResult.remnants) {
      const rect: Rect = {
        x: toUnits(remnant.xMm),
        y: toUnits(remnant.yMm),
        width: toUnits(remnant.widthMm),
        height: toUnits(remnant.lengthMm),
      };
      const minWidth = sheet.minRemnantWidthMm ? toUnits(sheet.minRemnantWidthMm) : ZERO;
      const minLength = sheet.minRemnantLengthMm ? toUnits(sheet.minRemnantLengthMm) : ZERO;
      if (rect.width < minWidth || rect.height < minLength) {
        add({
          code: "REMNANT_TOO_SMALL",
          message: "잔재 기준에 못 미치는 조각을 잔재로 보고했습니다.",
          sheetIndex: sheetResult.sheetIndex,
        });
      }
      if (rects.some((placed) => overlaps(rect, placed))) {
        add({
          code: "REMNANT_OVERLAP",
          message: "잔재가 배치된 부품과 겹칩니다.",
          sheetIndex: sheetResult.sheetIndex,
        });
      }
    }

    if (!isGuillotine(rects)) {
      add({
        code: "NOT_GUILLOTINE",
        message: "직선 관통 절단으로 만들 수 없는 배치입니다.",
        sheetIndex: sheetResult.sheetIndex,
      });
    }

    const used = rects.reduce((total, rect) => total + rect.width * rect.height, ZERO);
    if (squareUnitsToM2(used) !== sheetResult.usedAreaM2) {
      add({
        code: "AREA_MISMATCH",
        message: "원판 사용 면적이 배치와 맞지 않습니다.",
        sheetIndex: sheetResult.sheetIndex,
      });
    }
  }

  for (const [sheetItemId, usedCount] of sheetUsage) {
    const limit = sheetsById.get(sheetItemId)?.availableCount ?? null;
    if (limit !== null && usedCount > limit) {
      add({
        code: "SHEET_LIMIT_EXCEEDED",
        message: `원판 ${sheetItemId}을 쓸 수 있는 장수보다 많이 사용했습니다.`,
      });
    }
  }

  const unplaced = new Map(result.summary.unplacedParts.map((item) => [item.partId, item.quantity]));
  for (const part of input.parts) {
    const total = (placedCount.get(part.id) ?? 0) + (unplaced.get(part.id) ?? 0);
    if (total !== part.quantity) {
      add({
        code: "QUANTITY_MISMATCH",
        message: `${part.label} 수량이 맞지 않습니다. 요청 ${part.quantity}, 배치·미배치 합계 ${total}.`,
        partId: part.id,
      });
    }
  }

  if (result.summary.sheetCount !== result.sheets.length) {
    add({ code: "AREA_MISMATCH", message: "요약의 원판 수가 배치 결과와 다릅니다." });
  }

  return violations;
}
