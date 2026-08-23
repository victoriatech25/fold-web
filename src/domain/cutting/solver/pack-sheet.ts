import {
  ZERO,
  allowedOrientations,
  area,
  type Orientation,
  type PartUnit,
  type Rect,
  type SheetSpec,
} from "./geometry";

/**
 * 전략 축(`D2-B04-C`). 어느 조합이 좋은지는 입력에 달렸으므로 하나를 고르지 않고
 * 조합을 전부 돌린 뒤 목적함수로 고른다.
 */
export type PackStrategy = {
  order: "AREA_DESC" | "LONG_SIDE_DESC" | "WIDTH_DESC";
  freeChoice: "BEST_AREA_FIT" | "BEST_SHORT_SIDE_FIT";
  split: "SHORTER_AXIS" | "LONGER_AXIS";
};

export const packStrategies: PackStrategy[] = (
  ["AREA_DESC", "LONG_SIDE_DESC", "WIDTH_DESC"] as const
).flatMap((order) =>
  (["BEST_AREA_FIT", "BEST_SHORT_SIDE_FIT"] as const).flatMap((freeChoice) =>
    (["SHORTER_AXIS", "LONGER_AXIS"] as const).map((split) => ({ order, freeChoice, split })),
  ),
);

export type UnitPlacement = {
  unit: PartUnit;
  x: bigint;
  y: bigint;
  width: bigint;
  height: bigint;
  rotated: boolean;
};

export type SheetPacking = {
  placements: UnitPlacement[];
  /** 배치에 실제로 쓰인 부품 면적. kerf 여백은 빼고 센다. */
  usedArea: bigint;
  freeRects: Rect[];
  cutCount: number;
  /** 이 원판에 들어가지 못하고 남은 단위. 입력 순서를 유지한다. */
  leftover: PartUnit[];
};

function longSide(unit: PartUnit): bigint {
  return unit.width > unit.length ? unit.width : unit.length;
}

/**
 * 전략에 따라 배치 순서를 정한다. 값이 같으면 `partId`·순번으로 갈라
 * 같은 입력이 항상 같은 순서가 되게 한다(`D2-B03-C`).
 */
function sortUnits(units: PartUnit[], order: PackStrategy["order"]): PartUnit[] {
  const key = (unit: PartUnit): bigint => {
    if (order === "AREA_DESC") return unit.width * unit.length;
    if (order === "LONG_SIDE_DESC") return longSide(unit);
    return unit.width;
  };
  return [...units].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    if (leftKey !== rightKey) return leftKey > rightKey ? -1 : 1;
    if (left.partId !== right.partId) return left.partId < right.partId ? -1 : 1;
    return left.sequence - right.sequence;
  });
}

type Candidate = {
  freeIndex: number;
  orientation: Orientation;
  /** 작을수록 좋은 점수. 전략에 따라 남는 면적이나 짧은 변 여유를 쓴다. */
  score: bigint;
};

function scoreOf(
  free: Rect,
  orientation: Orientation,
  freeChoice: PackStrategy["freeChoice"],
): bigint {
  if (freeChoice === "BEST_AREA_FIT") {
    return area(free) - orientation.width * orientation.height;
  }
  const leftoverWidth = free.width - orientation.width;
  const leftoverHeight = free.height - orientation.height;
  return leftoverWidth < leftoverHeight ? leftoverWidth : leftoverHeight;
}

/**
 * 조각 하나를 부품이 차지한 만큼 잘라 남은 두 조각으로 바꾼다.
 *
 * 자유 조각을 항상 직선으로만 가르기 때문에 만들어진 배치는 언제나 직선 관통
 * 절단으로 재현할 수 있다(`D2-B03-J`). 검증 함수의 `NOT_GUILLOTINE` 을 사후에
 * 피하는 것이 아니라 구조적으로 만들지 않는다(`D2-B04-B`).
 *
 * 부품이 차지하는 폭에 kerf 를 더해 잘라내므로 이웃 조각과의 사이에 칼날
 * 두께가 남는다(`D2-B03-F`). 조각 끝이면 더할 자리가 없으므로 그대로 둔다.
 */
function splitFreeRect(
  free: Rect,
  orientation: Orientation,
  kerf: bigint,
  split: PackStrategy["split"],
): { children: Rect[]; cuts: number } {
  const consumedWidth =
    orientation.width + kerf > free.width ? free.width : orientation.width + kerf;
  const consumedHeight =
    orientation.height + kerf > free.height ? free.height : orientation.height + kerf;
  const leftoverWidth = free.width - consumedWidth;
  const leftoverHeight = free.height - consumedHeight;

  const splitAcross =
    split === "SHORTER_AXIS" ? leftoverWidth < leftoverHeight : leftoverWidth >= leftoverHeight;

  const right: Rect = splitAcross
    ? { x: free.x + consumedWidth, y: free.y, width: leftoverWidth, height: consumedHeight }
    : { x: free.x + consumedWidth, y: free.y, width: leftoverWidth, height: free.height };
  const top: Rect = splitAcross
    ? { x: free.x, y: free.y + consumedHeight, width: free.width, height: leftoverHeight }
    : { x: free.x, y: free.y + consumedHeight, width: consumedWidth, height: leftoverHeight };

  const children = [right, top].filter((rect) => rect.width > ZERO && rect.height > ZERO);
  return { children, cuts: children.length };
}

/**
 * 원판 한 장에 최대한 채운다. 이 함수는 원판 규격 선택을 하지 않는다.
 * 어느 규격을 열지는 `optimize.ts` 가 이 함수의 결과를 견줘 정한다(`D2-B04-D`).
 */
export function packSheet(
  units: PartUnit[],
  sheet: SheetSpec,
  kerf: bigint,
  strategy: PackStrategy,
): SheetPacking {
  const ordered = sortUnits(units, strategy.order);
  const freeRects: Rect[] = [{ ...sheet.usable }];
  const placements: UnitPlacement[] = [];
  const placed = new Set<PartUnit>();
  let usedArea = ZERO;
  let cutCount = 0;

  for (const unit of ordered) {
    const orientations = allowedOrientations(unit, sheet);
    let best: Candidate | null = null;

    for (let freeIndex = 0; freeIndex < freeRects.length; freeIndex += 1) {
      const free = freeRects[freeIndex];
      for (const orientation of orientations) {
        if (orientation.width > free.width || orientation.height > free.height) continue;
        const score = scoreOf(free, orientation, strategy.freeChoice);
        // 점수가 같으면 앞선 조각과 회전하지 않은 방향을 고른다.
        if (best === null || score < best.score) {
          best = { freeIndex, orientation, score };
        }
      }
    }

    if (!best) continue;

    const free = freeRects[best.freeIndex];
    placements.push({
      unit,
      x: free.x,
      y: free.y,
      width: best.orientation.width,
      height: best.orientation.height,
      rotated: best.orientation.rotated,
    });
    placed.add(unit);
    usedArea += best.orientation.width * best.orientation.height;

    const { children, cuts } = splitFreeRect(free, best.orientation, kerf, strategy.split);
    freeRects.splice(best.freeIndex, 1, ...children);
    cutCount += cuts;
  }

  return {
    placements,
    usedArea,
    freeRects,
    cutCount,
    leftover: units.filter((unit) => !placed.has(unit)),
  };
}
