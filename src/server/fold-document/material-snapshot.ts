import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  ANGLE_DECIMAL_POLICY,
  LENGTH_DECIMAL_POLICY,
  NON_NEGATIVE_LENGTH_DECIMAL_POLICY,
  POSITIVE_LENGTH_DECIMAL_POLICY,
  normalizeDecimalString,
} from "@/domain/fold-document/decimal";
import type { ServerFoldDocumentV1 } from "@/domain/fold-document/schema";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export class FoldMaterialRuleNotFoundError extends Error {
  readonly code = "MATERIAL_RULE_NOT_FOUND" as const;

  constructor() {
    super("사용할 수 있는 재질 계산 기준을 찾을 수 없습니다.");
    this.name = "FoldMaterialRuleNotFoundError";
  }
}

export async function resolvePublishedMaterialRuleSnapshot(
  database: DatabaseClient,
  organizationId: string,
  materialRuleRevisionId: string,
): Promise<ServerFoldDocumentV1["material"]> {
  const revision = await database.materialRuleRevision.findFirst({
    where: {
      id: materialRuleRevisionId,
      organizationId,
      status: { in: ["PUBLISHED", "RETIRED"] },
    },
    include: {
      materialVariant: {
        include: { material: true },
      },
    },
  });

  if (
    !revision ||
    revision.materialVariant.organizationId !== organizationId ||
    revision.materialVariant.material.organizationId !== organizationId ||
    !revision.materialVariant.active ||
    revision.materialVariant.deletedAt !== null ||
    !revision.materialVariant.material.active ||
    revision.materialVariant.material.deletedAt !== null
  ) {
    throw new FoldMaterialRuleNotFoundError();
  }

  return {
    ruleRevisionId: revision.id,
    name: revision.materialVariant.name,
    thicknessMm: normalizeDecimalString(
      revision.materialVariant.thicknessMm.toString(),
      POSITIVE_LENGTH_DECIMAL_POLICY,
    ),
    insideBendRadiusMm: normalizeDecimalString(
      revision.insideBendRadiusMm.toString(),
      NON_NEGATIVE_LENGTH_DECIMAL_POLICY,
    ),
    cutAngleDeg: normalizeDecimalString(revision.cutAngleDeg.toString(), ANGLE_DECIMAL_POLICY),
    elongationMm: {
      vCut: normalizeDecimalString(revision.elongationVCutMm.toString(), LENGTH_DECIMAL_POLICY),
      aCut: normalizeDecimalString(revision.elongationACutMm.toString(), LENGTH_DECIMAL_POLICY),
      noCut: normalizeDecimalString(revision.elongationNoCutMm.toString(), LENGTH_DECIMAL_POLICY),
    },
    cutDepthMm: {
      vCut: normalizeDecimalString(revision.cutDepthVCutMm.toString(), NON_NEGATIVE_LENGTH_DECIMAL_POLICY),
      aCut: normalizeDecimalString(revision.cutDepthACutMm.toString(), NON_NEGATIVE_LENGTH_DECIMAL_POLICY),
      noCut: normalizeDecimalString(revision.cutDepthNoCutMm.toString(), NON_NEGATIVE_LENGTH_DECIMAL_POLICY),
    },
  };
}
