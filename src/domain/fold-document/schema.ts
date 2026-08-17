import { z } from "zod";

import { projectCanonicalJsonV1 } from "./canonical";
import {
  ANGLE_DECIMAL_POLICY,
  LENGTH_DECIMAL_POLICY,
  NON_NEGATIVE_LENGTH_DECIMAL_POLICY,
  POSITIVE_LENGTH_DECIMAL_POLICY,
  decimalStringSchema,
} from "./decimal";
import {
  FoldDocumentValidationError,
  type FoldDocumentIssue,
  type FoldDocumentIssueCode,
} from "./errors";

export const SERVER_FOLD_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const CURRENT_SERVER_FOLD_DOCUMENT_SCHEMA_VERSION = 3 as const;
export const MAX_FOLD_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_FOLD_DOCUMENT_BLOCKS = 64;
export const MAX_FOLD_DOCUMENT_SEGMENTS = 1_000;

const localIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/, "로컬 ID는 영문, 숫자, '-'와 '_'만 사용할 수 있습니다.");
const trimmedName = (maximum: number) => z.string().trim().min(1).max(maximum);
const lengthDecimal = decimalStringSchema(LENGTH_DECIMAL_POLICY);
const nonNegativeLengthDecimal = decimalStringSchema(NON_NEGATIVE_LENGTH_DECIMAL_POLICY);
const positiveLengthDecimal = decimalStringSchema(POSITIVE_LENGTH_DECIMAL_POLICY);
const angleDecimal = decimalStringSchema(ANGLE_DECIMAL_POLICY);

const pointSchema = z.strictObject({
  xMm: lengthDecimal,
  yMm: lengthDecimal,
});

const directionSchema = z.enum(["none", "n", "ne", "e", "se", "s", "sw", "w", "nw"]);
const geometryBase = {
  start: pointSchema,
  end: pointSchema,
  direction: directionSchema,
};
const lineGeometrySchema = z.strictObject({
  kind: z.literal("line"),
  ...geometryBase,
});
const arcGeometrySchema = z.strictObject({
  kind: z.literal("arc"),
  ...geometryBase,
  side: z.enum(["left", "right"]),
  sagittaMm: positiveLengthDecimal,
});
const geometrySchema = z.discriminatedUnion("kind", [lineGeometrySchema, arcGeometrySchema]);

const expressionSchema = z.strictObject({
  grammarVersion: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  source: z.string().trim().min(1).max(512),
});

const productExpressionSchema = expressionSchema.extend({ enabled: z.boolean() });
const bendOperationSchema = z.strictObject({
  direction: z.enum(["front", "back"]),
  form: z.enum(["standard", "a", "zero", "u"]),
});
const junctionSchema = z.strictObject({
  angleDeg: angleDecimal,
  calculateElongation: z.boolean(),
  cutType: z.enum(["v-cut", "a-cut", "no-cut"]),
  operations: z.array(bendOperationSchema).min(1).max(2),
});
const manufacturingAnnotationSchema = z.strictObject({
  operator: z.enum(["+", "-", "*", "/"]),
  operand: nonNegativeLengthDecimal,
});

const segmentSchema = z.strictObject({
  id: localIdSchema,
  order: z.number().int().min(1).max(MAX_FOLD_DOCUMENT_SEGMENTS),
  geometry: geometrySchema,
  nominalLengthMm: positiveLengthDecimal,
  lengthExpression: expressionSchema.optional(),
  segmentCorrectionOverrideMm: lengthDecimal.optional(),
  junctionAfter: junctionSchema.optional(),
  manufacturingAnnotation: manufacturingAnnotationSchema.optional(),
});

const blockSchema = z.strictObject({
  id: localIdSchema,
  name: trimmedName(100),
  order: z.number().int().min(1).max(MAX_FOLD_DOCUMENT_BLOCKS),
  refNum: z.number().int().positive().optional(),
  segments: z.array(segmentSchema).max(MAX_FOLD_DOCUMENT_SEGMENTS),
});

const materialValueSetSchema = z.strictObject({
  vCut: lengthDecimal,
  aCut: lengthDecimal,
  noCut: lengthDecimal,
});

const materialCutDepthSchema = z.strictObject({
  vCut: nonNegativeLengthDecimal,
  aCut: nonNegativeLengthDecimal,
  noCut: nonNegativeLengthDecimal,
});

const materialSchema = z.strictObject({
  ruleRevisionId: z.uuid(),
  name: trimmedName(200),
  thicknessMm: positiveLengthDecimal,
  insideBendRadiusMm: nonNegativeLengthDecimal,
  cutAngleDeg: angleDecimal,
  elongationMm: materialValueSetSchema,
  cutDepthMm: materialCutDepthSchema,
});

const calculationSchema = z.strictObject({
  mode: z.enum(["fixed", "ratio"]),
  elongationOption: z.enum(["standard", "two-line", "diagonal", "ext1"]),
  vCutEnabled: z.boolean(),
  decimalPlaces: z.number().int().min(0).max(6),
  decimalOperation: z.enum(["none", "round", "floor", "ceil"]),
});

const variableSchema = z.strictObject({
  name: trimmedName(64),
  valueMm: lengthDecimal,
  expression: expressionSchema.optional(),
});

function addContractIssue(
  context: z.core.$RefinementCtx<unknown>,
  code: FoldDocumentIssueCode,
  path: Array<string | number>,
  message: string,
) {
  context.addIssue({
    code: "custom",
    path,
    message,
    params: { foldCode: code },
  });
}

const serverFoldDocumentV1BaseSchema = z.strictObject({
  schemaVersion: z.literal(SERVER_FOLD_DOCUMENT_SCHEMA_VERSION),
  documentType: z.enum(["normal", "box", "panel"]),
  name: trimmedName(200),
  product: z.strictObject({
    lengthMm: nonNegativeLengthDecimal,
    quantity: z.number().int().min(1).max(1_000_000),
  }),
  material: materialSchema,
  calculation: calculationSchema,
  variables: z.array(variableSchema).max(256),
  productExpression: productExpressionSchema.optional(),
  blocks: z.array(blockSchema).min(1).max(MAX_FOLD_DOCUMENT_BLOCKS),
});

export const serverFoldDocumentV1Schema = serverFoldDocumentV1BaseSchema.superRefine(
  (document, context) => {
    if (document.documentType === "normal" && document.blocks.length !== 1) {
      addContractIssue(
        context,
        "INVALID_BLOCK_COUNT",
        ["blocks"],
        "일반 절곡 문서는 block이 정확히 하나여야 합니다.",
      );
    }
    if (document.documentType === "box" && document.blocks.length !== 2) {
      addContractIssue(
        context,
        "INVALID_BLOCK_COUNT",
        ["blocks"],
        "박스 절곡 문서는 block이 정확히 두 개여야 합니다.",
      );
    }

    const ids = new Set<string>();
    let segmentCount = 0;
    document.blocks.forEach((block, blockIndex) => {
      if (ids.has(block.id)) {
        addContractIssue(
          context,
          "DUPLICATE_ID",
          ["blocks", blockIndex, "id"],
          "문서 내부 ID가 중복되었습니다.",
        );
      }
      ids.add(block.id);
      if (block.order !== blockIndex + 1) {
        addContractIssue(
          context,
          "NON_SEQUENTIAL_ORDER",
          ["blocks", blockIndex, "order"],
          "block order는 1부터 배열 순서대로 이어져야 합니다.",
        );
      }

      segmentCount += block.segments.length;
      block.segments.forEach((segment, segmentIndex) => {
        const path = ["blocks", blockIndex, "segments", segmentIndex] as Array<string | number>;
        if (ids.has(segment.id)) {
          addContractIssue(
            context,
            "DUPLICATE_ID",
            [...path, "id"],
            "문서 내부 ID가 중복되었습니다.",
          );
        }
        ids.add(segment.id);
        if (segment.order !== segmentIndex + 1) {
          addContractIssue(
            context,
            "NON_SEQUENTIAL_ORDER",
            [...path, "order"],
            "segment order는 1부터 배열 순서대로 이어져야 합니다.",
          );
        }
        if (
          segment.geometry.start.xMm === segment.geometry.end.xMm &&
          segment.geometry.start.yMm === segment.geometry.end.yMm
        ) {
          addContractIssue(
            context,
            "DEGENERATE_SEGMENT",
            [...path, "geometry", "end"],
            "segment 시작점과 끝점은 달라야 합니다.",
          );
        }
        const previous = block.segments[segmentIndex - 1];
        if (
          previous &&
          (previous.geometry.end.xMm !== segment.geometry.start.xMm ||
            previous.geometry.end.yMm !== segment.geometry.start.yMm)
        ) {
          addContractIssue(
            context,
            "DISCONNECTED_SEGMENT",
            [...path, "geometry", "start"],
            "이전 segment의 끝점과 현재 segment의 시작점이 일치해야 합니다.",
          );
        }
        if (segmentIndex === block.segments.length - 1 && segment.junctionAfter) {
          addContractIssue(
            context,
            "INVALID_LAST_JUNCTION",
            [...path, "junctionAfter"],
            "마지막 segment 뒤에는 절곡 junction을 둘 수 없습니다.",
          );
        }
        if (segment.junctionAfter) {
          const operations = new Set<string>();
          segment.junctionAfter.operations.forEach((operation, operationIndex) => {
            const key = `${operation.direction}:${operation.form}`;
            if (operations.has(key)) {
              addContractIssue(
                context,
                "DUPLICATE_OPERATION",
                [...path, "junctionAfter", "operations", operationIndex],
                "같은 방향과 형태의 절곡 작업을 중복할 수 없습니다.",
              );
            }
            operations.add(key);
          });
        }
      });
    });

    if (segmentCount > MAX_FOLD_DOCUMENT_SEGMENTS) {
      addContractIssue(
        context,
        "DOCUMENT_TOO_LARGE",
        ["blocks"],
        `문서 전체 segment는 최대 ${MAX_FOLD_DOCUMENT_SEGMENTS}개입니다.`,
      );
    }

    const variableNames = new Set<string>();
    document.variables.forEach((variable, index) => {
      if (variableNames.has(variable.name)) {
        addContractIssue(
          context,
          "DUPLICATE_VARIABLE",
          ["variables", index, "name"],
          "변수 이름이 중복되었습니다.",
        );
      }
      variableNames.add(variable.name);
    });

    const size = new TextEncoder().encode(projectCanonicalJsonV1(JSON.parse(JSON.stringify(document)))).byteLength;
    if (size > MAX_FOLD_DOCUMENT_BYTES) {
      addContractIssue(
        context,
        "DOCUMENT_TOO_LARGE",
        [],
        `절곡 문서는 최대 ${MAX_FOLD_DOCUMENT_BYTES} bytes입니다.`,
      );
    }
  },
);

export type ServerFoldDocumentV1 = z.infer<typeof serverFoldDocumentV1Schema>;

const boxDefinitionSchema = z.strictObject({
  widthBaseSegmentId: localIdSchema,
  depthBaseSegmentId: localIdSchema,
});

const panelAttachmentSchema = z.strictObject({
  id: localIdSchema,
  name: trimmedName(100),
  hostBlockId: localIdSchema,
  hostSegmentId: localIdSchema,
  direction: z.enum(["clockwise", "counterclockwise"]),
  dimensionRole: z.enum(["none", "secondary-product-dimension"]),
  sourceRevisionId: z.uuid().optional(),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  block: blockSchema,
});

const serverFoldDocumentV2BaseSchema = z.strictObject({
  schemaVersion: z.literal(2),
  documentType: z.enum(["normal", "box", "panel"]),
  name: trimmedName(200),
  product: z.strictObject({
    lengthMm: nonNegativeLengthDecimal,
    quantity: z.number().int().min(1).max(1_000_000),
  }),
  material: materialSchema,
  calculation: calculationSchema,
  variables: z.array(variableSchema).max(256),
  productExpression: productExpressionSchema.optional(),
  blocks: z.array(blockSchema).min(1).max(MAX_FOLD_DOCUMENT_BLOCKS),
  boxDefinition: boxDefinitionSchema.optional(),
  panelAttachments: z.array(panelAttachmentSchema).max(MAX_FOLD_DOCUMENT_BLOCKS),
});

export const serverFoldDocumentV2Schema = serverFoldDocumentV2BaseSchema.superRefine(
  (document, context) => {
    const { boxDefinition: _boxDefinition, panelAttachments: _panelAttachments, ...common } = document;
    void _boxDefinition;
    void _panelAttachments;
    const base = safeParseServerFoldDocumentV1({ ...common, schemaVersion: 1 });
    if (!base.success) {
      base.issues.forEach((issue) => addContractIssue(context, issue.code, issue.path, issue.message));
      return;
    }

    const blockById = new Map(document.blocks.map((block) => [block.id, block]));
    const ids = new Set(document.blocks.flatMap((block) => [block.id, ...block.segments.map((segment) => segment.id)]));
    let dimensionRoles = 0;
    const hostSegments = new Set<string>();
    document.panelAttachments.forEach((panel, index) => {
      const panelBlockValidation = safeParseServerFoldDocumentV1({
        ...common,
        schemaVersion: 1,
        documentType: "normal",
        blocks: [{ ...panel.block, order: 1 }],
      });
      if (!panelBlockValidation.success) {
        panelBlockValidation.issues.forEach((issue) => {
          const nestedPath = issue.path[0] === "blocks"
            ? issue.path.slice(2)
            : issue.path;
          addContractIssue(
            context,
            issue.code,
            ["panelAttachments", index, "block", ...nestedPath],
            issue.message,
          );
        });
      }
      const hostBlock = blockById.get(panel.hostBlockId);
      if (!hostBlock?.segments.some((segment) => segment.id === panel.hostSegmentId)) {
        addContractIssue(context, "INVALID_DOCUMENT", ["panelAttachments", index, "hostSegmentId"], "패널 연결 대상 선을 찾을 수 없습니다.");
      }
      if (hostSegments.has(panel.hostSegmentId)) {
        addContractIssue(context, "INVALID_DOCUMENT", ["panelAttachments", index, "hostSegmentId"], "같은 선에는 패널을 하나만 연결할 수 있습니다.");
      }
      hostSegments.add(panel.hostSegmentId);
      if (panel.dimensionRole === "secondary-product-dimension") dimensionRoles += 1;
      [panel.id, panel.block.id, ...panel.block.segments.map((segment) => segment.id)].forEach((id) => {
        if (ids.has(id)) addContractIssue(context, "DUPLICATE_ID", ["panelAttachments", index], "패널과 주 단면의 ID가 중복되었습니다.");
        ids.add(id);
      });
    });
    if (dimensionRoles > 1) {
      addContractIssue(context, "INVALID_DOCUMENT", ["panelAttachments"], "제품 두 번째 치수 역할 패널은 하나만 지정할 수 있습니다.");
    }

    const size = new TextEncoder().encode(projectCanonicalJsonV1(document)).byteLength;
    if (size > MAX_FOLD_DOCUMENT_BYTES) {
      addContractIssue(context, "DOCUMENT_TOO_LARGE", [], `절곡 문서는 최대 ${MAX_FOLD_DOCUMENT_BYTES} bytes입니다.`);
    }
  },
);

export type ServerFoldDocumentV2 = z.infer<typeof serverFoldDocumentV2Schema>;

export const sheetItemSnapshotSchema = z.strictObject({
  sheetItemId: z.uuid(),
  materialVariantId: z.uuid(),
  code: trimmedName(50),
  name: trimmedName(100),
  finishName: z.string().trim().max(100).nullable(),
  widthMm: positiveLengthDecimal,
  lengthMm: positiveLengthDecimal,
  rotationPolicy: z.enum(["FREE", "KEEP_GRAIN"]),
  grainAxis: z.enum(["NONE", "WIDTH", "LENGTH"]),
  trimTopMm: nonNegativeLengthDecimal,
  trimRightMm: nonNegativeLengthDecimal,
  trimBottomMm: nonNegativeLengthDecimal,
  trimLeftMm: nonNegativeLengthDecimal,
  nominalAreaM2: positiveLengthDecimal,
  usableWidthMm: positiveLengthDecimal,
  usableLengthMm: positiveLengthDecimal,
  usableAreaM2: positiveLengthDecimal,
  effectiveWeightKg: positiveLengthDecimal.nullable(),
  weightSource: z.enum(["CALCULATED", "OVERRIDE", "UNAVAILABLE"]),
});

const serverFoldDocumentV3BaseSchema = z.strictObject({
  ...serverFoldDocumentV2BaseSchema.shape,
  schemaVersion: z.literal(CURRENT_SERVER_FOLD_DOCUMENT_SCHEMA_VERSION),
  sheetItemSnapshot: sheetItemSnapshotSchema.optional(),
});

export const serverFoldDocumentV3Schema = serverFoldDocumentV3BaseSchema.superRefine(
  (document, context) => {
    const { sheetItemSnapshot: _sheetItemSnapshot, ...v2 } = document;
    void _sheetItemSnapshot;
    const base = serverFoldDocumentV2Schema.safeParse({ ...v2, schemaVersion: 2 });
    if (!base.success) {
      zodErrorToIssues(base.error).forEach((issue) => addContractIssue(context, issue.code, issue.path, issue.message));
      return;
    }
    const size = new TextEncoder().encode(projectCanonicalJsonV1(JSON.parse(JSON.stringify(document)))).byteLength;
    if (size > MAX_FOLD_DOCUMENT_BYTES) addContractIssue(context, "DOCUMENT_TOO_LARGE", [], `절곡 문서는 최대 ${MAX_FOLD_DOCUMENT_BYTES} bytes입니다.`);
  },
);

export type SheetItemSnapshot = z.infer<typeof sheetItemSnapshotSchema>;
export type ServerFoldDocumentV3 = z.infer<typeof serverFoldDocumentV3Schema>;
export type ServerFoldDocument = ServerFoldDocumentV1 | ServerFoldDocumentV2 | ServerFoldDocumentV3;

function toIssuePath(path: PropertyKey[]): Array<string | number> {
  return path.filter((part): part is string | number => typeof part === "string" || typeof part === "number");
}

function zodErrorToIssues(error: z.ZodError): FoldDocumentIssue[] {
  return error.issues.flatMap((issue): FoldDocumentIssue[] => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        code: "UNKNOWN_FIELD",
        path: [...toIssuePath(issue.path), key],
        message: `허용되지 않은 필드입니다: ${key}`,
        severity: "error",
      }));
    }
    const foldCode =
      issue.code === "custom" && typeof issue.params?.foldCode === "string"
        ? issue.params.foldCode as FoldDocumentIssueCode
        : issue.code === "too_big" && ["blocks", "segments"].includes(String(issue.path.at(-1)))
          ? "DOCUMENT_TOO_LARGE"
        : "INVALID_DOCUMENT";
    return [{
      code: foldCode,
      path: toIssuePath(issue.path),
      message: issue.code === "custom" ? issue.message : "절곡 문서 필드가 올바르지 않습니다.",
      severity: "error",
    }];
  });
}

export type FoldDocumentParseResult =
  | { success: true; document: ServerFoldDocumentV1 }
  | { success: false; issues: FoldDocumentIssue[] };

export function safeParseServerFoldDocumentV1(input: unknown): FoldDocumentParseResult {
  const result = serverFoldDocumentV1Schema.safeParse(input);
  return result.success
    ? { success: true, document: result.data }
    : { success: false, issues: zodErrorToIssues(result.error) };
}

export function parseServerFoldDocumentV1(input: unknown): ServerFoldDocumentV1 {
  const result = safeParseServerFoldDocumentV1(input);
  if (!result.success) throw new FoldDocumentValidationError(result.issues);
  return result.document;
}

export function parseServerFoldDocumentV2(input: unknown): ServerFoldDocumentV2 {
  const result = serverFoldDocumentV2Schema.safeParse(input);
  if (!result.success) throw new FoldDocumentValidationError(zodErrorToIssues(result.error));
  return result.data;
}

export function parseServerFoldDocumentV3(input: unknown): ServerFoldDocumentV3 {
  const result = serverFoldDocumentV3Schema.safeParse(input);
  if (!result.success) throw new FoldDocumentValidationError(zodErrorToIssues(result.error));
  return result.data;
}

export function migrateServerFoldDocumentV1ToV2(input: ServerFoldDocumentV1): ServerFoldDocumentV2 {
  return parseServerFoldDocumentV2({
    ...input,
    schemaVersion: 2,
    panelAttachments: [],
  });
}

export function migrateServerFoldDocumentV2ToV3(input: ServerFoldDocumentV2): ServerFoldDocumentV3 {
  return parseServerFoldDocumentV3({ ...input, schemaVersion: 3 });
}

export function parseServerFoldDocument(input: unknown): ServerFoldDocumentV3 {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new FoldDocumentValidationError([{ code: "INVALID_DOCUMENT", path: [], message: "절곡 문서 JSON 객체가 필요합니다.", severity: "error" }]);
  }
  const version = (input as Record<string, unknown>).schemaVersion;
  if (version === 1) return migrateServerFoldDocumentV2ToV3(migrateServerFoldDocumentV1ToV2(parseServerFoldDocumentV1(input)));
  if (version === 2) return migrateServerFoldDocumentV2ToV3(parseServerFoldDocumentV2(input));
  if (version === 3) return parseServerFoldDocumentV3(input);
  throw new FoldDocumentValidationError([{
    code: "UNSUPPORTED_SCHEMA_VERSION",
    path: ["schemaVersion"],
    message: `지원하지 않는 절곡 문서 버전입니다: ${String(version)}`,
    severity: "error",
  }]);
}

export function migrateFoldDocumentToCurrent(input: unknown): ServerFoldDocumentV3 {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new FoldDocumentValidationError([{
      code: "INVALID_DOCUMENT",
      path: [],
      message: "절곡 문서 JSON 객체가 필요합니다.",
      severity: "error",
    }]);
  }
  return parseServerFoldDocument(input);
}
