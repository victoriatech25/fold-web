import type { ServerFoldDocument } from "@/domain/fold-document/schema";

export type FoldCategoryDto = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  sortOrder: number;
  lockVersion: number;
};

export type FoldLibraryUserDto = { id: string; displayName: string };

export type FoldRevisionSummaryDto = {
  revisionId: string;
  revisionNumber: number;
  status: "DRAFT" | "REVIEW" | "PUBLISHED" | "RETIRED";
  name: string;
  lockVersion: number;
  checksumSha256: string;
  updatedAt: string;
  statusChangedAt: string;
  updatedBy: FoldLibraryUserDto | null;
  publishedAt: string | null;
};

export type FoldTemplateSummaryDto = {
  templateId: string;
  code: string;
  name: string;
  documentType: "normal" | "box" | "panel";
  category: FoldCategoryDto | null;
  lockVersion: number;
  updatedAt: string;
  currentRevision: FoldRevisionSummaryDto | null;
  revisionCount: number;
};

export type FoldTemplateListDto = {
  items: FoldTemplateSummaryDto[];
  nextCursor: string | null;
};

export type FoldTemplateDetailDto = FoldTemplateSummaryDto & {
  revisions: FoldRevisionSummaryDto[];
};

export type FoldRevisionDetailDto = FoldRevisionSummaryDto & {
  templateId: string;
  templateName: string;
  document: ServerFoldDocument;
};
