import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { projectCanonicalJsonV1 } from "@/domain/fold-document/canonical";
import {
  FoldDocumentValidationError,
  type FoldDocumentIssue,
} from "@/domain/fold-document/errors";
import {
  SERVER_FOLD_DOCUMENT_SCHEMA_VERSION,
  CURRENT_SERVER_FOLD_DOCUMENT_SCHEMA_VERSION,
  parseServerFoldDocument,
  parseServerFoldDocumentV1,
  parseServerFoldDocumentV2,
  parseServerFoldDocumentV3,
  type ServerFoldDocumentV3,
} from "@/domain/fold-document/schema";

import { calculateFoldDocumentChecksum, verifyFoldDocumentChecksum } from "./checksum";

export type PreparedFoldRevisionDocument = {
  materialRuleRevisionId: string;
  documentSchemaVersion: typeof CURRENT_SERVER_FOLD_DOCUMENT_SCHEMA_VERSION;
  document: Prisma.InputJsonValue;
  documentChecksumSha256: string;
};

export type PersistedFoldRevisionDocument = {
  materialRuleRevisionId: string | null;
  documentSchemaVersion: number;
  document: unknown;
  documentChecksumSha256: string;
};

function invariantError(
  code: "SCHEMA_VERSION_MISMATCH" | "MATERIAL_RULE_MISMATCH",
  path: Array<string | number>,
  message: string,
): FoldDocumentValidationError {
  const issue: FoldDocumentIssue = { code, path, message, severity: "error" };
  return new FoldDocumentValidationError([issue]);
}

export function prepareFoldRevisionDocument(input: unknown): PreparedFoldRevisionDocument {
  const document = parseServerFoldDocument(input);
  const canonical = projectCanonicalJsonV1(document);

  return {
    materialRuleRevisionId: document.material.ruleRevisionId,
    documentSchemaVersion: CURRENT_SERVER_FOLD_DOCUMENT_SCHEMA_VERSION,
    document: JSON.parse(canonical) as Prisma.InputJsonValue,
    documentChecksumSha256: calculateFoldDocumentChecksum(document),
  };
}

export function readFoldRevisionDocument(
  record: PersistedFoldRevisionDocument,
): ServerFoldDocumentV3 {
  if (![1, 2, 3].includes(record.documentSchemaVersion)) {
    throw invariantError(
      "SCHEMA_VERSION_MISMATCH",
      ["schemaVersion"],
      "DB row와 절곡 문서의 schema version이 일치하지 않습니다.",
    );
  }
  const embeddedSchemaVersion = typeof record.document === "object"
    && record.document !== null
    && "schemaVersion" in record.document
    ? record.document.schemaVersion
    : undefined;
  if (embeddedSchemaVersion !== record.documentSchemaVersion) {
    throw invariantError(
      "SCHEMA_VERSION_MISMATCH",
      ["schemaVersion"],
      "DB row와 절곡 문서의 schema version이 일치하지 않습니다.",
    );
  }
  const persisted = record.documentSchemaVersion === SERVER_FOLD_DOCUMENT_SCHEMA_VERSION
    ? parseServerFoldDocumentV1(record.document)
    : record.documentSchemaVersion === 2
      ? parseServerFoldDocumentV2(record.document)
      : parseServerFoldDocumentV3(record.document);
  if (persisted.schemaVersion !== record.documentSchemaVersion) {
    throw invariantError("SCHEMA_VERSION_MISMATCH", ["schemaVersion"], "DB row와 절곡 문서의 schema version이 일치하지 않습니다.");
  }
  if (record.materialRuleRevisionId !== persisted.material.ruleRevisionId) {
    throw invariantError(
      "MATERIAL_RULE_MISMATCH",
      ["material", "ruleRevisionId"],
      "DB row와 절곡 문서의 재질 계산 기준이 일치하지 않습니다.",
    );
  }
  verifyFoldDocumentChecksum(persisted, record.documentChecksumSha256);
  return parseServerFoldDocument(persisted);
}
