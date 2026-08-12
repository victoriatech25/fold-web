import type { FoldPriceResult, FoldPricingMetrics } from "@/domain/pricing";

export type PriceScopeTypeDto = "STANDARD" | "TIER" | "CUSTOMER";
export type PriceRevisionStatusDto = "DRAFT" | "REVIEW" | "PUBLISHED" | "RETIRED";
export type PriceEffectiveStatusDto = PriceRevisionStatusDto | "SCHEDULED" | "ACTIVE" | "EXPIRED";

export type PriceTierDto = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
  lockVersion: number;
  customerCount: number;
};

export type PriceBookSummaryDto = {
  id: string;
  code: string;
  name: string;
  scopeType: PriceScopeTypeDto;
  priceTier: { id: string; code: string; name: string } | null;
  customer: { id: string; code: string; name: string } | null;
  active: boolean;
  lockVersion: number;
  currentRevisionId: string | null;
  scheduledRevisionId: string | null;
  openRevisionId: string | null;
  revisionCount: number;
};

export type FoldPriceRateFields = {
  materialVariantId: string;
  materialRatePerM2Krw: string;
  bendRatePerOperationKrw: string;
  vCutRatePerMeterKrw: string;
};

export type SheetPriceRateFields = {
  sheetItemId: string;
  materialPricePerSheetKrw: string;
  processingPricePerSheetKrw: string | null;
};

export type PriceSurchargeFields = {
  minimumBendOperations: number;
  ratePercent: string;
  baseType: "PROCESSING_ONLY";
};

export type PriceRevisionFields = {
  changeSummary: string | null;
  foldRates: FoldPriceRateFields[];
  sheetRates: SheetPriceRateFields[];
  surchargePolicy: PriceSurchargeFields | null;
};

export type PriceRevisionDto = PriceRevisionFields & {
  id: string;
  revisionNumber: number;
  status: PriceRevisionStatusDto;
  effectiveStatus: PriceEffectiveStatusDto;
  currency: "KRW";
  taxIncluded: false;
  contentChecksumSha256: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type PricingMaterialDto = {
  id: string;
  code: string;
  name: string;
  variants: Array<{
    id: string;
    code: string;
    name: string;
    thicknessMm: string;
    sheetItems: Array<{ id: string; code: string; name: string; widthMm: string; lengthMm: string }>;
  }>;
};

export type PricingWorkspaceDto = {
  tiers: PriceTierDto[];
  books: PriceBookSummaryDto[];
  customers: Array<{ id: string; code: string; name: string; priceTierId: string | null; lockVersion: number }>;
  materials: PricingMaterialDto[];
};

export type PriceBookWorkspaceDto = {
  book: PriceBookSummaryDto;
  revisions: PriceRevisionDto[];
  materials: PricingMaterialDto[];
};

export type PriceRevisionTransitionAction = "review" | "return" | "publish" | "retire" | "discard";

export type FoldPricePreviewDto = FoldPriceResult & {
  customer: { id: string; code: string; name: string };
  materialVariant: { id: string; code: string; name: string };
  preview: boolean;
  notForOrder: boolean;
};

export type ManualFoldPriceInput = {
  customerId: string;
  materialVariantId: string;
  metrics: FoldPricingMetrics;
  effectiveAt?: string | null;
};
