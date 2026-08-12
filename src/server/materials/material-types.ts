export type MaterialRuleSummaryDto = {
  id: string;
  revisionNumber: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  insideBendRadiusMm: string;
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
