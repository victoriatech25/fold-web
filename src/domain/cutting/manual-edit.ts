import {
  assignPlacementKeys,
  type CuttingAnnotations,
  type LaserGroup,
} from "@/domain/cutting/annotations";
import {
  CUTTING_CONTRACT_VERSION,
  type CuttingInput,
  type CuttingPart,
  type CuttingPlacement,
  type CuttingResult,
  type CuttingSheet,
  type CuttingSheetResult,
} from "@/domain/cutting/schema";
import { squareUnitsToM2, toUnits, unitsToMm, yieldPercent } from "@/domain/cutting/units";
import {
  validateCuttingResult,
  type CuttingViolation,
  type CuttingViolationCode,
} from "@/domain/cutting/validate";

/**
 * 편집기에서 저장한 배치(`P2-B11` 4.4). solver 를 거치지 않으므로 결과 조립과
 * 검증을 여기서 한다. 배치 좌표는 계약 좌표(왼쪽 아래 원점) 그대로다.
 */
export const MANUAL_EDIT_ENGINE_VERSION = "manual-edit-v1" as const;

export type ManualEditSheet = {
  sheetItemId: string;
  placements: CuttingPlacement[];
};

export type AnnotationViolationCode =
  | "ANNOTATION_UNKNOWN_SHEET"
  | "ANNOTATION_UNKNOWN_PLACEMENT"
  | "LASER_GROUP_MIXED_PART"
  | "LASER_GROUP_NOT_RECTANGLE"
  | "LASER_GROUP_OVERLAP"
  | "CUT_LINE_CROSSES_PART"
  | "CUT_LINE_OUT_OF_SHEET";

export type ManualEditViolationCode = CuttingViolationCode | AnnotationViolationCode;

export type ManualEditViolation = Omit<CuttingViolation, "code"> & {
  code: ManualEditViolationCode;
  annotationId?: string;
};

export type ManualEditValidation = {
  /** 저장을 막는 것. */
  violations: ManualEditViolation[];
  /** 저장은 허용하되 남겨 두는 것(`D2-B11-G`). */
  warnings: ManualEditViolation[];
};

/** 편집 개정에서는 거부하지 않고 경고로 낮추는 검사(`D2-B11-G`). */
const WARNING_CODES: ReadonlySet<CuttingViolationCode> = new Set(["NOT_GUILLOTINE", "KERF_NOT_KEPT"]);

const ZERO = BigInt(0);

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

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * 편집기가 보낸 원판별 배치로 결과를 조립한다. 미배치 수량은 입력 수량에서 배치 수를
 * 빼서 서버가 센다 — 편집기와 서버가 다른 숫자를 들고 있을 수 없게 한다.
 * 잔재 사각형은 보고하지 않는다. `P2-B06` 은 남은 조각을 손실로 세므로 면적 차로 충분하다.
 */
export function buildManualEditResult(input: CuttingInput, sheets: ManualEditSheet[]): CuttingResult {
  const partsById = new Map(input.parts.map((part) => [part.id, part]));
  const sheetsById = new Map(input.sheets.map((sheet) => [sheet.sheetItemId, sheet]));
  const placedCount = new Map<string, number>();
  let usedArea = ZERO;
  let totalArea = ZERO;

  const resultSheets: CuttingSheetResult[] = sheets.map((sheet, sheetIndex) => {
    const spec = sheetsById.get(sheet.sheetItemId);
    if (spec) totalArea += toUnits(spec.widthMm) * toUnits(spec.lengthMm);
    let sheetUsed = ZERO;
    for (const placement of sheet.placements) {
      const part = partsById.get(placement.partId);
      if (!part) continue;
      placedCount.set(part.id, (placedCount.get(part.id) ?? 0) + 1);
      sheetUsed += toUnits(part.widthMm) * toUnits(part.lengthMm);
    }
    usedArea += sheetUsed;
    return {
      sheetIndex,
      sheetItemId: sheet.sheetItemId,
      placements: sheet.placements,
      usedAreaM2: squareUnitsToM2(sheetUsed),
      remnants: [],
    };
  });

  return {
    contractVersion: CUTTING_CONTRACT_VERSION,
    engineVersion: MANUAL_EDIT_ENGINE_VERSION,
    seed: null,
    sheets: resultSheets,
    summary: {
      sheetCount: resultSheets.length,
      totalAreaM2: squareUnitsToM2(totalArea),
      usedAreaM2: squareUnitsToM2(usedArea),
      yieldPercent: yieldPercent(usedArea, totalArea),
      unplacedParts: input.parts
        .filter((part) => (placedCount.get(part.id) ?? 0) < part.quantity)
        .map((part) => ({
          partId: part.id,
          quantity: part.quantity - (placedCount.get(part.id) ?? 0),
          reason: "OTHER" as const,
        })),
    },
  };
}

type PlacedEntry = { key: string; placement: CuttingPlacement; part: CuttingPart; rect: Rect };

function indexPlacements(input: CuttingInput, sheet: CuttingSheetResult): Map<string, PlacedEntry> {
  const partsById = new Map(input.parts.map((part) => [part.id, part]));
  const keys = assignPlacementKeys(sheet);
  const entries = new Map<string, PlacedEntry>();
  sheet.placements.forEach((placement, index) => {
    const part = partsById.get(placement.partId);
    if (!part) return;
    entries.set(keys[index], { key: keys[index], placement, part, rect: placedRect(part, placement) });
  });
  return entries;
}

function groupBounds(members: PlacedEntry[]): Rect {
  let minX = members[0].rect.x;
  let minY = members[0].rect.y;
  let maxX = members[0].rect.x + members[0].rect.width;
  let maxY = members[0].rect.y + members[0].rect.height;
  for (const member of members) {
    if (member.rect.x < minX) minX = member.rect.x;
    if (member.rect.y < minY) minY = member.rect.y;
    if (member.rect.x + member.rect.width > maxX) maxX = member.rect.x + member.rect.width;
    if (member.rect.y + member.rect.height > maxY) maxY = member.rect.y + member.rect.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 같은 크기 사각형들이 행×열 격자를 빠짐없이 채우는지. */
function isGrid(members: PlacedEntry[]): boolean {
  const xs = new Set(members.map((member) => member.rect.x));
  const ys = new Set(members.map((member) => member.rect.y));
  if (xs.size * ys.size !== members.length) return false;
  const seen = new Set(members.map((member) => `${member.rect.x}:${member.rect.y}`));
  for (const x of xs) for (const y of ys) if (!seen.has(`${x}:${y}`)) return false;
  return true;
}

/**
 * 지정을 검사하고, 통과한 레이저 그룹의 `boundsMm` 를 배치에서 다시 계산해 채운다.
 * 반환한 annotations 를 저장한다. 편집기가 보낸 bounds 는 믿지 않는다.
 */
export function validateAnnotations(
  input: CuttingInput,
  result: CuttingResult,
  annotations: CuttingAnnotations,
): { violations: ManualEditViolation[]; normalized: CuttingAnnotations } {
  const violations: ManualEditViolation[] = [];
  const add = (violation: ManualEditViolation) => violations.push(violation);
  const sheetsById = new Map(input.sheets.map((sheet) => [sheet.sheetItemId, sheet]));
  const indexed = new Map<number, Map<string, PlacedEntry>>();
  const entriesOf = (sheetIndex: number) => {
    const cached = indexed.get(sheetIndex);
    if (cached) return cached;
    const sheet = result.sheets[sheetIndex];
    const entries = sheet ? indexPlacements(input, sheet) : new Map<string, PlacedEntry>();
    indexed.set(sheetIndex, entries);
    return entries;
  };
  const knownSheet = (sheetIndex: number, annotationId?: string) => {
    if (result.sheets[sheetIndex]) return true;
    add({
      code: "ANNOTATION_UNKNOWN_SHEET",
      message: `원판 ${sheetIndex + 1}이 배치 결과에 없습니다.`,
      sheetIndex,
      annotationId,
    });
    return false;
  };

  const claimed = new Map<string, string>();
  const laserGroups: LaserGroup[] = [];
  for (const group of annotations.laserGroups) {
    if (!knownSheet(group.sheetIndex, group.id)) continue;
    const entries = entriesOf(group.sheetIndex);
    const members: PlacedEntry[] = [];
    let valid = true;
    for (const key of group.placementKeys) {
      const entry = entries.get(key);
      if (!entry) {
        add({
          code: "ANNOTATION_UNKNOWN_PLACEMENT",
          message: `레이저 그룹이 가리키는 배치 ${key}가 원판 ${group.sheetIndex + 1}에 없습니다.`,
          sheetIndex: group.sheetIndex,
          annotationId: group.id,
        });
        valid = false;
        continue;
      }
      const owner = claimed.get(`${group.sheetIndex}:${key}`);
      if (owner && owner !== group.id) {
        add({
          code: "LASER_GROUP_OVERLAP",
          message: `${entry.part.label}이 두 레이저 그룹에 속해 있습니다.`,
          sheetIndex: group.sheetIndex,
          partId: entry.part.id,
          annotationId: group.id,
        });
        valid = false;
      }
      claimed.set(`${group.sheetIndex}:${key}`, group.id);
      members.push(entry);
    }
    if (!valid || members.length === 0) continue;

    const first = members[0];
    if (members.some((m) => m.part.id !== first.part.id || m.placement.rotated !== first.placement.rotated)) {
      add({
        code: "LASER_GROUP_MIXED_PART",
        message: "레이저 그룹은 같은 부품을 같은 방향으로 놓은 것만 묶을 수 있습니다.",
        sheetIndex: group.sheetIndex,
        annotationId: group.id,
      });
      continue;
    }

    const bounds = groupBounds(members);
    const memberKeys = new Set(members.map((member) => member.key));
    const intruder = [...entries.values()].find(
      (entry) => !memberKeys.has(entry.key) && overlaps(entry.rect, bounds),
    );
    if (!isGrid(members) || intruder) {
      add({
        code: "LASER_GROUP_NOT_RECTANGLE",
        message: intruder
          ? `레이저 그룹 사각형 안에 다른 부품(${intruder.part.label})이 있습니다.`
          : "레이저 그룹은 행×열 격자로 놓인 부품만 묶을 수 있습니다.",
        sheetIndex: group.sheetIndex,
        annotationId: group.id,
      });
      continue;
    }

    laserGroups.push({
      ...group,
      boundsMm: {
        xMm: unitsToMm(bounds.x),
        yMm: unitsToMm(bounds.y),
        widthMm: unitsToMm(bounds.width),
        lengthMm: unitsToMm(bounds.height),
      },
    });
  }

  for (const line of annotations.horizontalCutLines) {
    if (!knownSheet(line.sheetIndex, line.id)) continue;
    const sheet = sheetsById.get(result.sheets[line.sheetIndex].sheetItemId);
    const y = toUnits(line.yMm);
    if (sheet) {
      const usable = usableArea(sheet);
      if (y < usable.y || y > usable.y + usable.height) {
        add({
          code: "CUT_LINE_OUT_OF_SHEET",
          message: `가로 절단선이 원판 ${line.sheetIndex + 1}의 사용 영역 밖에 있습니다.`,
          sheetIndex: line.sheetIndex,
          annotationId: line.id,
        });
        continue;
      }
    }
    const crossed = [...entriesOf(line.sheetIndex).values()].find(
      (entry) => entry.rect.y < y && y < entry.rect.y + entry.rect.height,
    );
    if (crossed) {
      add({
        code: "CUT_LINE_CROSSES_PART",
        message: `가로 절단선이 ${crossed.part.label}을 가로지릅니다.`,
        sheetIndex: line.sheetIndex,
        partId: crossed.part.id,
        annotationId: line.id,
      });
    }
  }

  const seenSheets = new Set<number>();
  for (const sheet of annotations.sheets) {
    if (!knownSheet(sheet.sheetIndex)) continue;
    seenSheets.add(sheet.sheetIndex);
  }

  return {
    violations,
    normalized: {
      ...annotations,
      laserGroups,
      sheets: annotations.sheets.filter((sheet) => seenSheets.has(sheet.sheetIndex)),
    },
  };
}

/**
 * 편집 개정의 저장 전 검증. 배치는 `validateCuttingResult` 그대로 돌리되 guillotine·kerf 는
 * 경고로 낮추고(`D2-B11-G`), 그 위에 지정 검사를 얹는다.
 */
export function validateManualEdit(
  input: CuttingInput,
  result: CuttingResult,
  annotations: CuttingAnnotations,
): ManualEditValidation & { normalizedAnnotations: CuttingAnnotations } {
  const violations: ManualEditViolation[] = [];
  const warnings: ManualEditViolation[] = [];
  for (const violation of validateCuttingResult(input, result)) {
    (WARNING_CODES.has(violation.code) ? warnings : violations).push(violation);
  }
  const annotated = validateAnnotations(input, result, annotations);
  violations.push(...annotated.violations);
  return { violations, warnings, normalizedAnnotations: annotated.normalized };
}
