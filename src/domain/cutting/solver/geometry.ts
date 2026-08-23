import type { CuttingPart, CuttingSheet, GrainDirection } from "@/domain/cutting/schema";
import { toUnits } from "@/domain/cutting/units";

export const ZERO = BigInt(0);

export type Rect = { x: bigint; y: bigint; width: bigint; height: bigint };

export function area(rect: Rect): bigint {
  return rect.width * rect.height;
}

/** 배치 단위 하나. 수량이 2 이상인 부품은 같은 부품을 가리키는 여러 단위가 된다. */
export type PartUnit = {
  partId: string;
  label: string;
  /** 회전하지 않았을 때의 폭·길이. */
  width: bigint;
  length: bigint;
  rotationAllowed: boolean;
  grainDirection: GrainDirection;
  /** 같은 부품 안에서의 순번. 정렬 tie-break 를 결정론으로 만든다. */
  sequence: number;
};

export type SheetSpec = {
  sheetItemId: string;
  /** trim 을 뺀 배치 가능 영역. 원판 좌표계 기준이다(`D2-B03-I`). */
  usable: Rect;
  totalArea: bigint;
  rotationPolicy: CuttingSheet["rotationPolicy"];
  grainAxis: GrainDirection;
  minRemnantWidth: bigint;
  minRemnantLength: bigint;
  /** ㎡ 기준이 아니라 내부 단위² 로 바꿔 둔 최소 잔재 면적. */
  minRemnantArea: bigint;
  availableCount: number | null;
  /** 입력에 적힌 순서. 동률일 때 앞선 것을 고른다. */
  order: number;
};

export function toPartUnits(parts: CuttingPart[]): PartUnit[] {
  const units: PartUnit[] = [];
  for (const part of parts) {
    for (let sequence = 0; sequence < part.quantity; sequence += 1) {
      units.push({
        partId: part.id,
        label: part.label,
        width: toUnits(part.widthMm),
        length: toUnits(part.lengthMm),
        rotationAllowed: part.rotationAllowed,
        grainDirection: part.grainDirection,
        sequence,
      });
    }
  }
  return units;
}

export function toSheetSpecs(sheets: CuttingSheet[]): SheetSpec[] {
  return sheets.map((sheet, order) => {
    const left = toUnits(sheet.trimLeftMm);
    const bottom = toUnits(sheet.trimBottomMm);
    const width = toUnits(sheet.widthMm);
    const length = toUnits(sheet.lengthMm);
    return {
      sheetItemId: sheet.sheetItemId,
      usable: {
        x: left,
        y: bottom,
        width: width - left - toUnits(sheet.trimRightMm),
        height: length - bottom - toUnits(sheet.trimTopMm),
      },
      totalArea: width * length,
      rotationPolicy: sheet.rotationPolicy,
      grainAxis: sheet.grainAxis,
      minRemnantWidth: sheet.minRemnantWidthMm ? toUnits(sheet.minRemnantWidthMm) : ZERO,
      minRemnantLength: sheet.minRemnantLengthMm ? toUnits(sheet.minRemnantLengthMm) : ZERO,
      // ㎡ 를 내부 단위² 로 올린다. 1㎡ = 10^18 내부 단위².
      minRemnantArea: sheet.minRemnantAreaM2
        ? (toUnits(sheet.minRemnantAreaM2) * BigInt(10) ** BigInt(18)) / BigInt(1_000_000)
        : ZERO,
      availableCount: sheet.availableCount,
      order,
    };
  });
}

/** 놓인 방향에서 부품의 결이 향하는 축. `validate.ts` 와 같은 규칙이다. */
export function placedGrain(unit: PartUnit, rotated: boolean): GrainDirection {
  if (unit.grainDirection === "NONE") return "NONE";
  if (!rotated) return unit.grainDirection;
  return unit.grainDirection === "WIDTH" ? "LENGTH" : "WIDTH";
}

export type Orientation = { width: bigint; height: bigint; rotated: boolean };

/**
 * 이 원판에서 허용되는 놓기 방향. 회전은 원판 정책과 부품 허용을 모두 만족해야
 * 하고(`D2-B03-G`), 결이 어긋나는 방향은 아예 후보에서 뺀다(`D2-B03-H`).
 */
export function allowedOrientations(unit: PartUnit, sheet: SheetSpec): Orientation[] {
  const candidates: Orientation[] = [{ width: unit.width, height: unit.length, rotated: false }];
  if (unit.rotationAllowed && sheet.rotationPolicy === "FREE") {
    candidates.push({ width: unit.length, height: unit.width, rotated: true });
  }
  return candidates.filter((candidate) => {
    if (sheet.grainAxis === "NONE") return true;
    const grain = placedGrain(unit, candidate.rotated);
    return grain === "NONE" || grain === sheet.grainAxis;
  });
}

/** 결을 무시하고 크기만 봤을 때 놓을 수 있는 방향. 미배치 사유를 가릴 때 쓴다. */
export function orientationsIgnoringGrain(unit: PartUnit, sheet: SheetSpec): Orientation[] {
  const candidates: Orientation[] = [{ width: unit.width, height: unit.length, rotated: false }];
  if (unit.rotationAllowed && sheet.rotationPolicy === "FREE") {
    candidates.push({ width: unit.length, height: unit.width, rotated: true });
  }
  return candidates;
}

export function fitsInUsable(orientation: Orientation, sheet: SheetSpec): boolean {
  return (
    orientation.width <= sheet.usable.width && orientation.height <= sheet.usable.height
  );
}
