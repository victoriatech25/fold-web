import type {
  FoldProfile,
  PointMm,
} from "@/domain/fold-profile";
import {
  FOLD_EXPRESSION_GRAMMAR_VERSION,
  normalizeFoldVariableName,
  resolveFoldProfileExpressions,
} from "@/domain/fold-expression";

import {
  ANGLE_DECIMAL_POLICY,
  LENGTH_DECIMAL_POLICY,
  NON_NEGATIVE_LENGTH_DECIMAL_POLICY,
  POSITIVE_LENGTH_DECIMAL_POLICY,
  DecimalContractError,
  canonicalDecimalToLosslessNumber,
  numberToCanonicalDecimal,
  type DecimalPolicy,
} from "./decimal";
import {
  FoldDocumentValidationError,
  type FoldDocumentIssue,
} from "./errors";
import {
  parseServerFoldDocument,
  parseServerFoldDocumentV1,
  parseServerFoldDocumentV2,
  parseServerFoldDocumentV3,
  type ServerFoldDocumentV3,
  type ServerFoldDocumentV2,
  type ServerFoldDocumentV1,
} from "./schema";

const LEGACY_BROWSER_EXPRESSION_GRAMMAR = "fold-profile-v3";

function supportedExpressionGrammar(grammarVersion: string) {
  return grammarVersion === FOLD_EXPRESSION_GRAMMAR_VERSION
    || grammarVersion === LEGACY_BROWSER_EXPRESSION_GRAMMAR;
}

function conversionError(
  error: unknown,
  path: Array<string | number>,
): FoldDocumentValidationError {
  const decimalError = error as DecimalContractError;
  const issue: FoldDocumentIssue = {
    code: decimalError.code ?? "LOSSY_NUMBER_CONVERSION",
    path,
    message: decimalError.message || "Decimal 값을 현재 편집기와 무손실 변환할 수 없습니다.",
    severity: "error",
  };
  return new FoldDocumentValidationError([issue]);
}

function fromNumber(
  value: number,
  policy: DecimalPolicy,
  path: Array<string | number>,
): string {
  try {
    return numberToCanonicalDecimal(value, policy);
  } catch (error) {
    throw conversionError(error, path);
  }
}

function toNumber(
  value: string,
  policy: DecimalPolicy,
  path: Array<string | number>,
): number {
  try {
    return canonicalDecimalToLosslessNumber(value, policy);
  } catch (error) {
    throw conversionError(error, path);
  }
}

function directionFromPoints(start: PointMm, end: PointMm): ServerFoldDocumentV1["blocks"][number]["segments"][number]["geometry"]["direction"] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const nearZero = (value: number) => Math.abs(value) <= 1e-9;
  const horizontal = nearZero(dy);
  const vertical = nearZero(dx);
  const diagonal = nearZero(Math.abs(dx) - Math.abs(dy));

  if (horizontal && dx > 0) return "e";
  if (horizontal && dx < 0) return "w";
  if (vertical && dy > 0) return "s";
  if (vertical && dy < 0) return "n";
  if (diagonal && dx > 0 && dy > 0) return "se";
  if (diagonal && dx > 0 && dy < 0) return "ne";
  if (diagonal && dx < 0 && dy > 0) return "sw";
  if (diagonal && dx < 0 && dy < 0) return "nw";
  return "none";
}

export function browserFoldProfileV3ToServerDocumentV1(
  profile: FoldProfile,
  materialRuleRevisionId: string,
): ServerFoldDocumentV1 {
  const expressionResolution = resolveFoldProfileExpressions(profile);
  const document = {
    schemaVersion: 1 as const,
    documentType: profile.profileType,
    name: profile.name,
    product: {
      lengthMm: expressionResolution.productLengthDecimal,
      quantity: profile.product.quantity,
    },
    material: {
      ruleRevisionId: materialRuleRevisionId,
      name: profile.material.name,
      thicknessMm: fromNumber(
        profile.material.thickness,
        POSITIVE_LENGTH_DECIMAL_POLICY,
        ["material", "thickness"],
      ),
      insideBendRadiusMm: fromNumber(
        profile.material.insideBendRadius,
        NON_NEGATIVE_LENGTH_DECIMAL_POLICY,
        ["material", "insideBendRadius"],
      ),
      cutAngleDeg: fromNumber(
        profile.material.cutAngle,
        ANGLE_DECIMAL_POLICY,
        ["material", "cutAngle"],
      ),
      elongationMm: {
        vCut: fromNumber(profile.material.elongation["v-cut"], LENGTH_DECIMAL_POLICY, ["material", "elongation", "v-cut"]),
        aCut: fromNumber(profile.material.elongation["a-cut"], LENGTH_DECIMAL_POLICY, ["material", "elongation", "a-cut"]),
        noCut: fromNumber(profile.material.elongation["no-cut"], LENGTH_DECIMAL_POLICY, ["material", "elongation", "no-cut"]),
      },
      cutDepthMm: {
        vCut: fromNumber(profile.material.cutDepth["v-cut"], NON_NEGATIVE_LENGTH_DECIMAL_POLICY, ["material", "cutDepth", "v-cut"]),
        aCut: fromNumber(profile.material.cutDepth["a-cut"], NON_NEGATIVE_LENGTH_DECIMAL_POLICY, ["material", "cutDepth", "a-cut"]),
        noCut: fromNumber(profile.material.cutDepth["no-cut"], NON_NEGATIVE_LENGTH_DECIMAL_POLICY, ["material", "cutDepth", "no-cut"]),
      },
    },
    calculation: {
      ...profile.calculation,
    },
    variables: profile.variables.map((variable, index) => ({
      name: normalizeFoldVariableName(variable.name),
      valueMm: expressionResolution.variableValues[normalizeFoldVariableName(variable.name)]
        ?? fromNumber(variable.value, LENGTH_DECIMAL_POLICY, ["variables", index, "value"]),
      ...(variable.formula && {
        expression: {
          grammarVersion: FOLD_EXPRESSION_GRAMMAR_VERSION,
          source: variable.formula,
        },
      }),
    })),
    ...(profile.product.formula && {
      productExpression: {
        enabled: profile.product.formulaEnabled ?? false,
        grammarVersion: FOLD_EXPRESSION_GRAMMAR_VERSION,
        source: profile.product.formula,
      },
    }),
    blocks: profile.blocks.map((block, blockIndex) => ({
      id: block.id,
      name: block.name,
      order: blockIndex + 1,
      segments: block.segments.map((segment, segmentIndex) => {
        const path = ["blocks", blockIndex, "segments", segmentIndex] as Array<string | number>;
        return {
          id: segment.id,
          order: segmentIndex + 1,
          geometry: {
            kind: segment.geometry?.kind === "arc" ? "arc" as const : "line" as const,
            start: {
              xMm: fromNumber(segment.start.x, LENGTH_DECIMAL_POLICY, [...path, "start", "x"]),
              yMm: fromNumber(segment.start.y, LENGTH_DECIMAL_POLICY, [...path, "start", "y"]),
            },
            end: {
              xMm: fromNumber(segment.end.x, LENGTH_DECIMAL_POLICY, [...path, "end", "x"]),
              yMm: fromNumber(segment.end.y, LENGTH_DECIMAL_POLICY, [...path, "end", "y"]),
            },
            direction: directionFromPoints(segment.start, segment.end),
            ...(segment.geometry?.kind === "arc" && {
              side: segment.geometry.side,
              sagittaMm: fromNumber(
                segment.geometry.sagitta,
                POSITIVE_LENGTH_DECIMAL_POLICY,
                [...path, "geometry", "sagitta"],
              ),
            }),
          },
          nominalLengthMm: expressionResolution.segmentLengths[segment.id]
            ?? fromNumber(
              segment.inputLength,
              POSITIVE_LENGTH_DECIMAL_POLICY,
              [...path, "inputLength"],
            ),
          ...(segment.formula !== undefined && {
            lengthExpression: {
                grammarVersion: FOLD_EXPRESSION_GRAMMAR_VERSION,
              source: segment.formula,
            },
          }),
          ...(segment.elongationOverride !== undefined && {
            segmentCorrectionOverrideMm: fromNumber(
              segment.elongationOverride,
              LENGTH_DECIMAL_POLICY,
              [...path, "elongationOverride"],
            ),
          }),
          ...(segment.bendAfter !== undefined && {
            junctionAfter: {
              angleDeg: fromNumber(
                segment.bendAfter.angle,
                ANGLE_DECIMAL_POLICY,
                [...path, "bendAfter", "angle"],
              ),
              calculateElongation: segment.calculateElongation ?? true,
              cutType: segment.bendAfter.cutType,
              operations: [
                {
                  direction: segment.bendAfter.direction,
                  form: segment.bendAfter.form ?? "standard",
                },
                ...(segment.bendAfter.secondaryOperation
                  ? [segment.bendAfter.secondaryOperation]
                  : []),
              ],
            },
          }),
        };
      }),
    })),
  };

  return parseServerFoldDocumentV1(document);
}

export type BrowserFoldProfileMetadata = {
  id: string;
  createdAt: string;
  updatedAt: string;
};

function unsupportedEditorFeature(
  path: Array<string | number>,
  message: string,
): never {
  throw new FoldDocumentValidationError([{
    code: "UNSUPPORTED_CAPABILITY",
    path,
    message,
    severity: "error",
  }]);
}

export function serverDocumentV1ToBrowserFoldProfileV3(
  input: unknown,
  metadata: BrowserFoldProfileMetadata,
): FoldProfile {
  const document = parseServerFoldDocumentV1(input);
  if (document.documentType === "panel") {
    unsupportedEditorFeature(["documentType"], "현재 편집기는 패널 문서를 무손실로 열 수 없습니다.");
  }
  document.variables.forEach((variable, index) => {
    if (variable.expression && !supportedExpressionGrammar(variable.expression.grammarVersion)) {
      unsupportedEditorFeature(["variables", index, "expression"], "지원하지 않는 변수 수식 문법입니다.");
    }
  });
  if (document.productExpression && !supportedExpressionGrammar(document.productExpression.grammarVersion)) {
    unsupportedEditorFeature(["productExpression"], "지원하지 않는 제품 수식 문법입니다.");
  }

  const blocks = document.blocks.map((block, blockIndex) => {
    if (block.refNum !== undefined) {
      unsupportedEditorFeature(["blocks", blockIndex, "refNum"], "현재 편집기는 패널 참조를 무손실로 열 수 없습니다.");
    }
    return {
      id: block.id,
      name: block.name,
      order: block.order,
      segments: block.segments.map((segment, segmentIndex) => {
        const path = ["blocks", blockIndex, "segments", segmentIndex] as Array<string | number>;
        if (segment.manufacturingAnnotation) {
          unsupportedEditorFeature(
            [...path, "manufacturingAnnotation"],
            "현재 편집기는 제작 annotation을 무손실로 열 수 없습니다.",
          );
        }
        if (
          segment.lengthExpression &&
          !supportedExpressionGrammar(segment.lengthExpression.grammarVersion)
        ) {
          unsupportedEditorFeature(
            [...path, "lengthExpression"],
            "현재 편집기가 생성하지 않은 수식을 무손실로 열 수 없습니다.",
          );
        }

        let bendAfter: FoldProfile["blocks"][number]["segments"][number]["bendAfter"];
        if (segment.junctionAfter) {
          const [operation, secondaryOperation] = segment.junctionAfter.operations;
          bendAfter = {
            direction: operation.direction,
            ...(operation.form !== "standard" && { form: operation.form }),
            ...(secondaryOperation && { secondaryOperation }),
            cutType: segment.junctionAfter.cutType,
            angle: toNumber(segment.junctionAfter.angleDeg, ANGLE_DECIMAL_POLICY, [...path, "junctionAfter", "angleDeg"]),
          };
        }

        return {
          id: segment.id,
          start: {
            x: toNumber(segment.geometry.start.xMm, LENGTH_DECIMAL_POLICY, [...path, "geometry", "start", "xMm"]),
            y: toNumber(segment.geometry.start.yMm, LENGTH_DECIMAL_POLICY, [...path, "geometry", "start", "yMm"]),
          },
          end: {
            x: toNumber(segment.geometry.end.xMm, LENGTH_DECIMAL_POLICY, [...path, "geometry", "end", "xMm"]),
            y: toNumber(segment.geometry.end.yMm, LENGTH_DECIMAL_POLICY, [...path, "geometry", "end", "yMm"]),
          },
          inputLength: toNumber(segment.nominalLengthMm, POSITIVE_LENGTH_DECIMAL_POLICY, [...path, "nominalLengthMm"]),
          geometry: segment.geometry.kind === "arc"
            ? {
                kind: "arc" as const,
                side: segment.geometry.side,
                sagitta: toNumber(segment.geometry.sagittaMm, POSITIVE_LENGTH_DECIMAL_POLICY, [...path, "geometry", "sagittaMm"]),
              }
            : { kind: "line" as const },
          ...(segment.lengthExpression && { formula: segment.lengthExpression.source }),
          ...(bendAfter && { bendAfter }),
          ...(segment.junctionAfter && { calculateElongation: segment.junctionAfter.calculateElongation }),
          ...(segment.segmentCorrectionOverrideMm !== undefined && {
            elongationOverride: toNumber(
              segment.segmentCorrectionOverrideMm,
              LENGTH_DECIMAL_POLICY,
              [...path, "segmentCorrectionOverrideMm"],
            ),
          }),
        };
      }),
    };
  });

  return {
    schemaVersion: 4,
    id: metadata.id,
    name: document.name,
    profileType: document.documentType,
    material: {
      id: document.material.ruleRevisionId,
      name: document.material.name,
      thickness: toNumber(document.material.thicknessMm, POSITIVE_LENGTH_DECIMAL_POLICY, ["material", "thicknessMm"]),
      insideBendRadius: toNumber(document.material.insideBendRadiusMm, NON_NEGATIVE_LENGTH_DECIMAL_POLICY, ["material", "insideBendRadiusMm"]),
      cutAngle: toNumber(document.material.cutAngleDeg, ANGLE_DECIMAL_POLICY, ["material", "cutAngleDeg"]),
      elongation: {
        "v-cut": toNumber(document.material.elongationMm.vCut, LENGTH_DECIMAL_POLICY, ["material", "elongationMm", "vCut"]),
        "a-cut": toNumber(document.material.elongationMm.aCut, LENGTH_DECIMAL_POLICY, ["material", "elongationMm", "aCut"]),
        "no-cut": toNumber(document.material.elongationMm.noCut, LENGTH_DECIMAL_POLICY, ["material", "elongationMm", "noCut"]),
      },
      cutDepth: {
        "v-cut": toNumber(document.material.cutDepthMm.vCut, NON_NEGATIVE_LENGTH_DECIMAL_POLICY, ["material", "cutDepthMm", "vCut"]),
        "a-cut": toNumber(document.material.cutDepthMm.aCut, NON_NEGATIVE_LENGTH_DECIMAL_POLICY, ["material", "cutDepthMm", "aCut"]),
        "no-cut": toNumber(document.material.cutDepthMm.noCut, NON_NEGATIVE_LENGTH_DECIMAL_POLICY, ["material", "cutDepthMm", "noCut"]),
      },
    },
    product: {
      length: toNumber(document.product.lengthMm, NON_NEGATIVE_LENGTH_DECIMAL_POLICY, ["product", "lengthMm"]),
      quantity: document.product.quantity,
      ...(document.productExpression && {
        formula: document.productExpression.source,
        formulaEnabled: document.productExpression.enabled,
      }),
    },
    calculation: {
      mode: document.calculation.mode,
      elongationOption: document.calculation.elongationOption,
      vCutEnabled: document.calculation.vCutEnabled,
      decimalPlaces: document.calculation.decimalPlaces,
      decimalOperation: document.calculation.decimalOperation,
    },
    variables: document.variables.map((variable, index) => ({
      name: normalizeFoldVariableName(variable.name),
      value: toNumber(variable.valueMm, LENGTH_DECIMAL_POLICY, ["variables", index, "valueMm"]),
      ...(variable.expression && { formula: variable.expression.source }),
    })),
    blocks,
    panelAttachments: [],
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  };
}

export function browserFoldProfileV4ToServerDocumentV2(
  profile: FoldProfile,
  materialRuleRevisionId: string,
): ServerFoldDocumentV2 {
  const base = browserFoldProfileV3ToServerDocumentV1(profile, materialRuleRevisionId);
  const panelAttachments = profile.panelAttachments.map((panel) => {
    const panelProfile: FoldProfile = {
      ...profile,
      profileType: "normal",
      blocks: [panel.block],
      boxDefinition: undefined,
      panelAttachments: [],
    };
    const block = browserFoldProfileV3ToServerDocumentV1(panelProfile, materialRuleRevisionId).blocks[0];
    return {
      id: panel.id,
      name: panel.name,
      hostBlockId: panel.hostBlockId,
      hostSegmentId: panel.hostSegmentId,
      direction: panel.direction,
      dimensionRole: panel.dimensionRole,
      ...(panel.sourceRevisionId && { sourceRevisionId: panel.sourceRevisionId }),
      ...(panel.sourceChecksum && { sourceChecksum: panel.sourceChecksum }),
      block,
    };
  });
  return parseServerFoldDocumentV2({
    ...base,
    schemaVersion: 2,
    panelAttachments,
  });
}

export function browserFoldProfileV4ToServerDocumentV3(
  profile: FoldProfile,
  materialRuleRevisionId: string,
): ServerFoldDocumentV3 {
  const v2 = browserFoldProfileV4ToServerDocumentV2(profile, materialRuleRevisionId);
  return parseServerFoldDocumentV3({
    ...v2,
    schemaVersion: 3,
    ...(profile.sheetItemSnapshot && { sheetItemSnapshot: profile.sheetItemSnapshot }),
  });
}

export function serverDocumentToBrowserFoldProfileV4(
  input: unknown,
  metadata: BrowserFoldProfileMetadata,
): FoldProfile {
  const document = parseServerFoldDocument(input);
  const { boxDefinition: _boxDefinition, panelAttachments: _panelAttachments, sheetItemSnapshot: _sheetItemSnapshot, ...documentBase } = document;
  void _boxDefinition;
  void _panelAttachments;
  void _sheetItemSnapshot;
  const v1 = parseServerFoldDocumentV1({
    ...documentBase,
    schemaVersion: 1,
  });
  const profile = serverDocumentV1ToBrowserFoldProfileV3(v1, metadata);
  profile.sheetItemSnapshot = document.sheetItemSnapshot
    ? { ...document.sheetItemSnapshot }
    : undefined;
  // boxDefinition은 과거 문서 호환을 위해 읽을 수만 있다. 현재 박스 바닥은
  // 두 단면에서 서로 교차하는 직선 쌍으로 자동 판정하며 다음 저장에서 제거한다.
  profile.boxDefinition = undefined;
  profile.panelAttachments = document.panelAttachments.map((panel) => {
    const panelDocument = parseServerFoldDocumentV1({
      ...v1,
      documentType: "normal",
      blocks: [panel.block],
    });
    const panelProfile = serverDocumentV1ToBrowserFoldProfileV3(panelDocument, metadata);
    return {
      id: panel.id,
      name: panel.name,
      hostBlockId: panel.hostBlockId,
      hostSegmentId: panel.hostSegmentId,
      direction: panel.direction,
      dimensionRole: panel.dimensionRole,
      ...(panel.sourceRevisionId && { sourceRevisionId: panel.sourceRevisionId }),
      ...(panel.sourceChecksum && { sourceChecksum: panel.sourceChecksum }),
      block: panelProfile.blocks[0],
    };
  });
  return profile;
}
