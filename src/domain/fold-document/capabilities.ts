import type { FoldDocumentIssue } from "./errors";
import type { ServerFoldDocument } from "./schema";

export type FoldDocumentCapability = "calculate" | "publish" | "dxf";

export type FoldDocumentCapabilityResult = {
  supported: boolean;
  issues: FoldDocumentIssue[];
};

function unsupported(path: Array<string | number>, message: string): FoldDocumentIssue {
  return {
    code: "UNSUPPORTED_CAPABILITY",
    path,
    message,
    severity: "error",
  };
}

export function validateFoldDocumentCapability(
  document: ServerFoldDocument,
  capability: FoldDocumentCapability,
): FoldDocumentCapabilityResult {
  const issues: FoldDocumentIssue[] = [];

  document.blocks.forEach((block, blockIndex) => {
    if (block.refNum !== undefined) {
      issues.push(unsupported(
        ["blocks", blockIndex, "refNum"],
        "패널 참조는 P1-12 전까지 실행할 수 없습니다.",
      ));
    }
    block.segments.forEach((segment, segmentIndex) => {
      const path = ["blocks", blockIndex, "segments", segmentIndex] as Array<string | number>;
      // P1-14/16: 원호와 복합 절곡 형식은 제조 형상/DXF 기준에서 지원한다.
      if (capability !== "calculate" && segment.manufacturingAnnotation) {
        issues.push(unsupported(
          [...path, "manufacturingAnnotation"],
          `제작 annotation은 현재 ${capability === "dxf" ? "DXF 출력" : "게시"} 기준에 포함되지 않습니다.`,
        ));
      }
    });
  });
  return { supported: issues.length === 0, issues };
}
