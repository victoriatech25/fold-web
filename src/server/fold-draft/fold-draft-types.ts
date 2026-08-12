import type { ServerFoldDocument, ServerFoldDocumentV1, SheetItemSnapshot } from "@/domain/fold-document/schema";

export type FoldDraftUserDto = {
  id: string;
  displayName: string;
};

export type FoldDraftSummaryDto = {
  draftId: string;
  templateId: string;
  name: string;
  documentType: ServerFoldDocument["documentType"];
  lockVersion: number;
  checksumSha256: string;
  createdAt: string;
  updatedAt: string;
  createdBy: FoldDraftUserDto | null;
  updatedBy: FoldDraftUserDto | null;
};

export type FoldDraftDetailDto = FoldDraftSummaryDto & {
  document: ServerFoldDocument;
};

export type FoldDraftListDto = {
  items: FoldDraftSummaryDto[];
  nextCursor: string | null;
};

export type FoldDraftConflictDto = Pick<
  FoldDraftSummaryDto,
  "draftId" | "lockVersion" | "checksumSha256" | "updatedAt" | "updatedBy"
>;

export type FoldMaterialOptionDto = {
  ruleRevisionId: string;
  materialVariantId: string;
  code: string;
  name: string;
  revisionNumber: number;
  material: ServerFoldDocumentV1["material"];
  calculation: ServerFoldDocumentV1["calculation"];
  sheetItems: SheetItemSnapshot[];
  defaultSheetItemId: string | null;
};
