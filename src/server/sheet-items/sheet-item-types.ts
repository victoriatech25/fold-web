export type SheetRotationPolicyDto = "FREE" | "KEEP_GRAIN";
export type SheetGrainAxisDto = "NONE" | "WIDTH" | "LENGTH";
export type SheetWeightSourceDto = "CALCULATED" | "OVERRIDE" | "UNAVAILABLE";

export type SheetItemFields = {
  code: string;
  name: string;
  finishName: string | null;
  widthMm: string;
  lengthMm: string;
  rotationPolicy: SheetRotationPolicyDto;
  grainAxis: SheetGrainAxisDto;
  trimTopMm: string;
  trimRightMm: string;
  trimBottomMm: string;
  trimLeftMm: string;
  weightOverrideKg: string | null;
  weightOverrideReason: string | null;
  standardPurchaseCostKrw: string | null;
  minRemnantWidthMm: string | null;
  minRemnantLengthMm: string | null;
  minRemnantAreaM2: string | null;
  sortOrder: number;
  memo: string | null;
};

export type SheetItemCalculationDto = {
  nominalAreaM2: string;
  usableWidthMm: string;
  usableLengthMm: string;
  usableAreaM2: string;
  calculatedWeightKg: string | null;
  effectiveWeightKg: string | null;
  weightSource: SheetWeightSourceDto;
};

export type SheetItemDto = SheetItemFields & {
  id: string;
  materialVariantId: string;
  inventoryUnit: "SHEET";
  isDefault: boolean;
  active: boolean;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  calculation: SheetItemCalculationDto;
};

export type SheetItemWorkspaceDto = {
  material: {
    id: string;
    code: string;
    name: string;
    densityKgPerM3: string | null;
    active: boolean;
  };
  variant: {
    id: string;
    code: string;
    name: string;
    thicknessMm: string;
    active: boolean;
  };
  items: SheetItemDto[];
  activeCount: number;
  defaultItemId: string | null;
};

export type SheetItemTransitionAction = "set_default" | "deactivate" | "reactivate";
