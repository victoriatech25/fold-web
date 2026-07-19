import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  PrismaClient,
  RevisionStatus,
} from "../src/generated/prisma/client";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://fold_web_app@127.0.0.1:5432/fold_web_dev?schema=public";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const permissions = [
  "customer.read",
  "customer.write",
  "material.read",
  "material.write",
  "material.approve",
  "template.fold.read",
  "template.fold.edit",
  "template.fold.publish",
  "order.read",
  "order.edit",
  "order.calculate",
  "order.approve",
  "cutting.optimize",
  "cutting.approve",
  "output.print",
  "machine.transfer",
  "admin.manage",
] as const;

async function seed() {
  const organizationCode = process.env.SEED_ORGANIZATION_CODE ?? "LOCAL_DEV";
  const organizationName = process.env.SEED_ORGANIZATION_NAME ?? "로컬 개발 조직";

  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.upsert({
      where: { code: organizationCode },
      update: { name: organizationName },
      create: {
        code: organizationCode,
        name: organizationName,
        companyProfile: { create: {} },
      },
    });

    const permissionRows = await Promise.all(
      permissions.map((key) =>
        tx.permission.upsert({
          where: { key },
          update: {},
          create: { key },
        }),
      ),
    );

    const administratorRole = await tx.role.upsert({
      where: {
        organizationId_key: {
          organizationId: organization.id,
          key: "ADMINISTRATOR",
        },
      },
      update: {
        name: "관리자",
        active: true,
      },
      create: {
        organizationId: organization.id,
        key: "ADMINISTRATOR",
        name: "관리자",
        description: "조직의 모든 초기 업무 권한",
        system: true,
      },
    });

    await Promise.all(
      permissionRows.map((permission) =>
        tx.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: administratorRole.id,
              permissionId: permission.id,
            },
          },
          update: {},
          create: {
            roleId: administratorRole.id,
            permissionId: permission.id,
          },
        }),
      ),
    );

    await tx.machineIntegrationConfig.upsert({
      where: { organizationId: organization.id },
      update: {
        status: "PLANNED",
        contractVersion: "placeholder-v1",
      },
      create: {
        organizationId: organization.id,
        status: "PLANNED",
        contractVersion: "placeholder-v1",
        note: "1단계에서는 항목만 제공하며 실제 기계 통신은 구현하지 않습니다.",
      },
    });

    const material = await tx.material.upsert({
      where: {
        organizationId_code: {
          organizationId: organization.id,
          code: "AL",
        },
      },
      update: {
        name: "알루미늄",
        active: true,
      },
      create: {
        organizationId: organization.id,
        code: "AL",
        name: "알루미늄",
        densityKgPerM3: "2700",
      },
    });

    const presets = [
      { code: "AL-1T", name: "알루미늄 1T", thickness: "1", v: "0.6", a: "0.4", noCut: "1" },
      { code: "AL-2T", name: "알루미늄 2T", thickness: "2", v: "1.2", a: "0.8", noCut: "2" },
      { code: "AL-3T", name: "알루미늄 3T", thickness: "3", v: "1.8", a: "1.2", noCut: "3" },
    ] as const;

    for (const preset of presets) {
      const variant = await tx.materialVariant.upsert({
        where: {
          organizationId_code: {
            organizationId: organization.id,
            code: preset.code,
          },
        },
        update: {
          name: preset.name,
          active: true,
        },
        create: {
          organizationId: organization.id,
          materialId: material.id,
          code: preset.code,
          name: preset.name,
          thicknessMm: preset.thickness,
          defaultInsideRadiusMm: preset.thickness,
        },
      });

      await tx.materialRuleRevision.upsert({
        where: {
          materialVariantId_revisionNumber: {
            materialVariantId: variant.id,
            revisionNumber: 1,
          },
        },
        update: {},
        create: {
          organizationId: organization.id,
          materialVariantId: variant.id,
          revisionNumber: 1,
          status: RevisionStatus.PUBLISHED,
          calculationMode: "FIXED",
          vCutEnabled: true,
          decimalPlaces: 1,
          decimalOperation: "ROUND",
          cutAngleDeg: "135",
          elongationVCutMm: preset.v,
          elongationACutMm: preset.a,
          elongationNoCutMm: preset.noCut,
          cutDepthVCutMm: "0.5",
          cutDepthACutMm: "0.5",
          cutDepthNoCutMm: "0",
          publishedAt: new Date("2026-07-19T00:00:00.000Z"),
        },
      });
    }

    await tx.foldCategory.upsert({
      where: {
        organizationId_code: {
          organizationId: organization.id,
          code: "DEFAULT",
        },
      },
      update: {
        name: "기본",
        active: true,
      },
      create: {
        organizationId: organization.id,
        code: "DEFAULT",
        name: "기본",
      },
    });
  });
}

seed()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error("Prisma seed failed.", error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
