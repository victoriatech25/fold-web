import {
  CUTTING_CONTRACT_VERSION,
  type CuttingInput,
  type CuttingObjective,
  type CuttingResult,
  type CuttingSheetResult,
} from "@/domain/cutting/schema";
import { squareUnitsToM2, toUnits, unitsToMm, yieldPercent } from "@/domain/cutting/units";
import {
  ZERO,
  allowedOrientations,
  fitsInUsable,
  orientationsIgnoringGrain,
  toPartUnits,
  toSheetSpecs,
  type PartUnit,
  type Rect,
  type SheetSpec,
} from "./geometry";
import { packSheet, packStrategies, type PackStrategy, type UnitPlacement } from "./pack-sheet";

/** solver 구현 버전. 계약 버전(`cutting-contract-v1`)과 따로 움직인다. */
export const CUTTING_ENGINE_VERSION = "cutting-solver-v1";

/** 탐색 시간 상한(`D2-B04-I`). 넘으면 그때까지의 최선을 낸다. */
export const DEFAULT_TIME_BUDGET_MS = 30_000;

/** 한 번의 최적화에서 열 수 있는 원판 장수 상한. 잘못된 입력에서 무한히 돌지 않게 한다. */
const MAX_SHEETS = 2_000;

export type OptimizeOptions = {
  timeBudgetMs?: number;
  /** 시간 측정을 바꿔 끼울 수 있게 열어 둔다. 테스트에서 쓴다. */
  now?: () => number;
};

type PlacedSheet = {
  spec: SheetSpec;
  placements: UnitPlacement[];
  usedArea: bigint;
  remnantCandidates: Rect[];
  cutCount: number;
};

type Plan = {
  sheets: PlacedSheet[];
  leftover: PartUnit[];
  usedArea: bigint;
  totalArea: bigint;
  cutCount: number;
};

/**
 * 목적함수(`D2-B04-E`).
 *
 * 미배치 수량을 가장 먼저 본다. `D2-B03-O` 의 우선순위는 부품이 모두 배치된
 * 상태를 전제로 한 것이라, 이것을 앞에 두지 않으면 아무것도 안 놓아 원판 수 0인
 * 계획이 최선으로 뽑힌다.
 */
function comparePlans(left: Plan, right: Plan, objective: CuttingObjective): number {
  if (left.leftover.length !== right.leftover.length) {
    return left.leftover.length - right.leftover.length;
  }

  const sheetCount = left.sheets.length - right.sheets.length;
  // 수율은 분모(전체 원판 면적)가 달라질 수 있으므로 교차 곱으로 견준다.
  const yieldOrder = (() => {
    const leftSide = left.usedArea * right.totalArea;
    const rightSide = right.usedArea * left.totalArea;
    if (leftSide === rightSide) return 0;
    return leftSide > rightSide ? -1 : 1;
  })();
  const cutCount = left.cutCount - right.cutCount;

  const order =
    objective === "YIELD_FIRST"
      ? [yieldOrder, sheetCount, cutCount]
      : objective === "CUT_COUNT_FIRST"
        ? [cutCount, sheetCount, yieldOrder]
        : [sheetCount, yieldOrder, cutCount];

  return order.find((value) => value !== 0) ?? 0;
}

/**
 * 남은 부품을 담을 원판 규격을 고른다(`D2-B04-D`).
 * 그 장에 채워지는 면적이 가장 큰 규격을 고르고, 동률이면 작은 규격을 고른다.
 */
function chooseSheet(
  remaining: PartUnit[],
  specs: SheetSpec[],
  usage: Map<string, number>,
  kerf: bigint,
  strategy: PackStrategy,
): PlacedSheet | null {
  let best: PlacedSheet | null = null;

  for (const spec of specs) {
    const used = usage.get(spec.sheetItemId) ?? 0;
    if (spec.availableCount !== null && used >= spec.availableCount) continue;

    const packing = packSheet(remaining, spec, kerf, strategy);
    if (packing.placements.length === 0) continue;

    const candidate: PlacedSheet = {
      spec,
      placements: packing.placements,
      usedArea: packing.usedArea,
      remnantCandidates: packing.freeRects,
      cutCount: packing.cutCount,
    };

    if (best === null) {
      best = candidate;
      continue;
    }
    if (candidate.usedArea > best.usedArea) {
      best = candidate;
      continue;
    }
    if (candidate.usedArea === best.usedArea) {
      if (candidate.spec.totalArea < best.spec.totalArea) best = candidate;
      else if (
        candidate.spec.totalArea === best.spec.totalArea &&
        candidate.spec.order < best.spec.order
      ) {
        best = candidate;
      }
    }
  }

  return best;
}

function buildPlan(
  units: PartUnit[],
  specs: SheetSpec[],
  kerf: bigint,
  strategy: PackStrategy,
): Plan {
  const usage = new Map<string, number>();
  const sheets: PlacedSheet[] = [];
  let remaining = units;

  while (remaining.length > 0 && sheets.length < MAX_SHEETS) {
    const chosen = chooseSheet(remaining, specs, usage, kerf, strategy);
    if (!chosen) break;

    sheets.push(chosen);
    usage.set(chosen.spec.sheetItemId, (usage.get(chosen.spec.sheetItemId) ?? 0) + 1);
    const placedUnits = new Set(chosen.placements.map((placement) => placement.unit));
    remaining = remaining.filter((unit) => !placedUnits.has(unit));
  }

  return {
    sheets,
    leftover: remaining,
    usedArea: sheets.reduce((total, sheet) => total + sheet.usedArea, ZERO),
    totalArea: sheets.reduce((total, sheet) => total + sheet.spec.totalArea, ZERO),
    cutCount: sheets.reduce((total, sheet) => total + sheet.cutCount, 0),
  };
}

/** 남은 부품이 왜 안 들어갔는지 가린다(`D2-B03-M`, `D2-B04-F`). */
function unplacedReason(
  unit: PartUnit,
  specs: SheetSpec[],
): "TOO_LARGE" | "GRAIN_CONFLICT" | "SHEET_LIMIT" | "OTHER" {
  const fitsIgnoringGrain = specs.some((spec) =>
    orientationsIgnoringGrain(unit, spec).some((orientation) => fitsInUsable(orientation, spec)),
  );
  if (!fitsIgnoringGrain) return "TOO_LARGE";

  const fitsWithGrain = specs.some((spec) =>
    allowedOrientations(unit, spec).some((orientation) => fitsInUsable(orientation, spec)),
  );
  if (!fitsWithGrain) return "GRAIN_CONFLICT";

  // 크기도 결도 맞는데 남았다면 쓸 수 있는 장수가 동났다는 뜻이다.
  if (specs.some((spec) => spec.availableCount !== null)) return "SHEET_LIMIT";
  return "OTHER";
}

function toResult(plan: Plan, input: CuttingInput, specs: SheetSpec[]): CuttingResult {
  const sheets: CuttingSheetResult[] = plan.sheets.map((sheet, sheetIndex) => ({
    sheetIndex,
    sheetItemId: sheet.spec.sheetItemId,
    placements: sheet.placements.map((placement) => ({
      partId: placement.unit.partId,
      xMm: unitsToMm(placement.x),
      yMm: unitsToMm(placement.y),
      rotated: placement.rotated,
    })),
    usedAreaM2: squareUnitsToM2(sheet.usedArea),
    remnants: sheet.remnantCandidates
      .filter(
        (rect) =>
          rect.width >= sheet.spec.minRemnantWidth &&
          rect.height >= sheet.spec.minRemnantLength &&
          rect.width * rect.height >= sheet.spec.minRemnantArea &&
          rect.width > ZERO &&
          rect.height > ZERO,
      )
      .map((rect) => ({
        xMm: unitsToMm(rect.x),
        yMm: unitsToMm(rect.y),
        widthMm: unitsToMm(rect.width),
        lengthMm: unitsToMm(rect.height),
        areaM2: squareUnitsToM2(rect.width * rect.height),
      })),
  }));

  const unplacedByPart = new Map<
    string,
    { quantity: number; reason: ReturnType<typeof unplacedReason> }
  >();
  for (const unit of plan.leftover) {
    const reason = unplacedReason(unit, specs);
    const previous = unplacedByPart.get(unit.partId);
    // 같은 부품에서 사유가 갈리면 더 근본적인 쪽(크기)을 남긴다.
    unplacedByPart.set(unit.partId, {
      quantity: (previous?.quantity ?? 0) + 1,
      reason: previous && previous.reason === "TOO_LARGE" ? "TOO_LARGE" : reason,
    });
  }

  return {
    contractVersion: CUTTING_CONTRACT_VERSION,
    engineVersion: CUTTING_ENGINE_VERSION,
    seed: input.options.seed,
    sheets,
    summary: {
      sheetCount: sheets.length,
      totalAreaM2: squareUnitsToM2(plan.totalArea),
      usedAreaM2: squareUnitsToM2(plan.usedArea),
      yieldPercent: yieldPercent(plan.usedArea, plan.totalArea),
      unplacedParts: input.parts
        .filter((part) => unplacedByPart.has(part.id))
        .map((part) => {
          const entry = unplacedByPart.get(part.id) ?? { quantity: 0, reason: "OTHER" as const };
          return { partId: part.id, quantity: entry.quantity, reason: entry.reason };
        }),
    },
  };
}

/**
 * 재단 최적화 본체(`P2-B04`).
 *
 * 무작위를 쓰지 않는다. 전략 조합을 정해진 순서로 모두 돌리고 목적함수가 가장
 * 좋은 계획을 고른다(`D2-B04-A`). 같은 입력은 항상 같은 결과를 낸다(`D2-B03-C`).
 * 시간 상한을 넘으면 남은 전략을 포기하고 그때까지의 최선을 낸다.
 */
export function optimizeCutting(input: CuttingInput, options: OptimizeOptions = {}): CuttingResult {
  const now = options.now ?? Date.now;
  const budget = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const startedAt = now();

  const units = toPartUnits(input.parts);
  const specs = toSheetSpecs(input.sheets);
  const kerf = toUnits(input.options.bladeKerfMm);

  // 첫 전략은 시간과 무관하게 반드시 한 번 돌린다. 결과가 없는 것보다 낫다.
  const [first, ...rest] = packStrategies;
  let best = buildPlan(units, specs, kerf, first);
  for (const strategy of rest) {
    if (now() - startedAt >= budget) break;
    const plan = buildPlan(units, specs, kerf, strategy);
    if (comparePlans(plan, best, input.options.objective) < 0) best = plan;
  }

  return toResult(best, input, specs);
}
