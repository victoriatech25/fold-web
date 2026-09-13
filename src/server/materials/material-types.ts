export type MaterialRuleSummaryDto = {
  id: string;
  revisionNumber: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  insideBendRadiusMm: string;
};

/** 진행 중(초안·검토) 개정. 두께 행에서 다음 단계를 안내하는 데 쓴다. */
export type MaterialOpenRuleDto = {
  id: string;
  revisionNumber: number;
  status: "DRAFT" | "REVIEW";
  lockVersion: number;
};

export type MaterialVariantDto = {
  id: string;
  code: string;
  name: string;
  thicknessMm: string;
  defaultInsideRadiusMm: string;
  sortOrder: number;
  active: boolean;
  lockVersion: number;
  updatedAt: string;
  publishedRule: MaterialRuleSummaryDto | null;
  openRule: MaterialOpenRuleDto | null;
};

export type MaterialSummaryDto = {
  id: string;
  code: string;
  name: string;
  densityKgPerM3: string | null;
  sortOrder: number;
  active: boolean;
  lockVersion: number;
  activeVariantCount: number;
  calculationRequiredCount: number;
  updatedAt: string;
};

export type MaterialDetailDto = MaterialSummaryDto & {
  memo: string | null;
  variants: MaterialVariantDto[];
};

export type MaterialListDto = { items: MaterialSummaryDto[]; nextCursor: string | null };

export type MaterialFields = {
  code: string;
  name: string;
  densityKgPerM3?: string | null;
  sortOrder: number;
  memo?: string | null;
};

export type MaterialVariantFields = {
  code: string;
  name: string;
  thicknessMm: string;
  defaultInsideRadiusMm: string;
  sortOrder: number;
};
