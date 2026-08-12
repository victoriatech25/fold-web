import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { projectCanonicalJsonV1 } from "@/domain/fold-document/canonical";
import { FoldDocumentChecksumError } from "@/domain/fold-document/errors";
import type { ServerFoldDocument } from "@/domain/fold-document/schema";

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;

export function calculateFoldDocumentChecksum(document: ServerFoldDocument): string {
  return createHash("sha256")
    .update(projectCanonicalJsonV1(document), "utf8")
    .digest("hex");
}

export function verifyFoldDocumentChecksum(
  document: ServerFoldDocument,
  expectedChecksum: string,
): void {
  const actual = calculateFoldDocumentChecksum(document);
  if (
    !CHECKSUM_PATTERN.test(expectedChecksum) ||
    !timingSafeEqual(Buffer.from(actual, "ascii"), Buffer.from(expectedChecksum, "ascii"))
  ) {
    throw new FoldDocumentChecksumError();
  }
}
