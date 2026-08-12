export type MaterialRuleStatus = "DRAFT" | "REVIEW" | "PUBLISHED" | "RETIRED";
export type MaterialRuleEffectiveStatus = "DRAFT" | "REVIEW" | "SCHEDULED" | "ACTIVE" | "EXPIRED" | "RETIRED";
export type MaterialRuleCalculationMode = "FIXED" | "RATIO";
export type MaterialRuleElongationOption = "STANDARD" | "TWO_LINE" | "DIAGONAL" | "EXT1";
export type MaterialRuleDecimalOperation = "NONE" | "ROUND" | "FLOOR" | "CEIL";

export type MaterialRuleFields = {
  calculationMode: MaterialRuleCalculationMode;
  elongationOption: MaterialRuleElongationOption;
  vCutEnabled: boolean;
  decimalPlaces: number;
  decimalOperation: MaterialRuleDecimalOperation;
  cutAngleDeg: string;
  insideBendRadiusMm: string;
  elongationVCutMm: string;
  elongationACutMm: string;
  elongationNoCutMm: string;
  cutDepthVCutMm: string;
  cutDepthACutMm: string;
  cutDepthNoCutMm: string;
  changeSummary: string | null;
};

export type MaterialRuleActorDto = { id: string; displayName: string };

export type MaterialRuleRevisionDto = MaterialRuleFields & {
  id: string;
  revisionNumber: number;
  status: MaterialRuleStatus;
  effectiveStatus: MaterialRuleEffectiveStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  contentChecksumSha256: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  createdBy: MaterialRuleActorDto | null;
  updatedBy: MaterialRuleActorDto | null;
  publishedBy: MaterialRuleActorDto | null;
};

export type MaterialRuleHistoryDto = {
  id: string;
  action: string;
  label: string;
  actorDisplayName: string | null;
  occurredAt: string;
  reason: string | null;
};

export type MaterialRuleWorkspaceDto = {
  material: { id: string; code: string; name: string; active: boolean };
  variant: {
    id: string;
    code: string;
    name: string;
    thicknessMm: string;
    defaultInsideRadiusMm: string;
    active: boolean;
  };
  revisions: MaterialRuleRevisionDto[];
  currentRuleId: string | null;
  scheduledRuleId: string | null;
  openRuleId: string | null;
  history: MaterialRuleHistoryDto[];
};

export type MaterialRulePreviewCaseDto = {
  key: string;
  label: string;
  candidateWidthMm: string;
  candidateCorrectionMm: string;
  currentWidthMm: string | null;
  currentCorrectionMm: string | null;
};

export type MaterialRulePreviewDto = {
  cases: MaterialRulePreviewCaseDto[];
  candidateChecksumSha256: string;
  currentRuleId: string | null;
};

export type MaterialRuleTransitionAction = "review" | "return" | "publish" | "retire" | "discard";
