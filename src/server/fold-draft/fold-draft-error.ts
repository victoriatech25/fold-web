import type { FoldDocumentIssue } from "@/domain/fold-document/errors";
import type { FoldDraftConflictDto } from "@/server/fold-draft/fold-draft-types";

export type FoldDraftServiceErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT";

export class FoldDraftServiceError extends Error {
  constructor(
    readonly code: FoldDraftServiceErrorCode,
    message: string,
    readonly details?: {
      issues?: FoldDocumentIssue[];
      conflict?: FoldDraftConflictDto;
    },
  ) {
    super(message);
    this.name = "FoldDraftServiceError";
  }
}
