export type FoldDocumentIssueCode =
  | "INVALID_DOCUMENT"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "UNKNOWN_FIELD"
  | "INVALID_DECIMAL"
  | "DECIMAL_SCALE_EXCEEDED"
  | "DECIMAL_PRECISION_EXCEEDED"
  | "DECIMAL_OUT_OF_RANGE"
  | "DUPLICATE_ID"
  | "DUPLICATE_VARIABLE"
  | "DUPLICATE_OPERATION"
  | "NON_SEQUENTIAL_ORDER"
  | "DISCONNECTED_SEGMENT"
  | "DEGENERATE_SEGMENT"
  | "INVALID_BLOCK_COUNT"
  | "INVALID_LAST_JUNCTION"
  | "UNSUPPORTED_CAPABILITY"
  | "LOSSY_NUMBER_CONVERSION"
  | "DOCUMENT_TOO_LARGE"
  | "SCHEMA_VERSION_MISMATCH"
  | "MATERIAL_RULE_MISMATCH"
  | "CHECKSUM_MISMATCH";

export type FoldDocumentIssue = {
  code: FoldDocumentIssueCode;
  path: Array<string | number>;
  message: string;
  severity: "error" | "warning";
};

export class FoldDocumentValidationError extends Error {
  readonly issues: FoldDocumentIssue[];

  constructor(issues: FoldDocumentIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "FoldDocumentValidationError";
    this.issues = issues;
  }
}

export class FoldDocumentChecksumError extends Error {
  readonly code = "CHECKSUM_MISMATCH" as const;

  constructor() {
    super("절곡 문서 checksum이 저장된 값과 일치하지 않습니다.");
    this.name = "FoldDocumentChecksumError";
  }
}
