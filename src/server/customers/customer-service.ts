import "server-only";

import type {
  CustomerType,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { requirePermission } from "@/server/authorization/authorization";
import { writeAuditEvent } from "@/server/audit/audit-writer";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { CustomerError } from "@/server/customers/customer-error";
import {
  decodeCustomerCursor,
  encodeCustomerCursor,
  formatCustomerCode,
  isValidCustomerSiteCode,
  normalizeBusinessRegistrationNumber,
  normalizeCustomerName,
  normalizeCustomerSiteCode,
  normalizeOptionalText,
} from "@/server/customers/customer-policy";
import type {
  CustomerContactDto,
  CustomerContactFields,
  CustomerDetailDto,
  CustomerFields,
  CustomerListDto,
  CustomerSiteDto,
  CustomerSiteFields,
  CustomerSummaryDto,
} from "@/server/customers/customer-types";

type Database = PrismaClient | Prisma.TransactionClient;
type Transaction = Prisma.TransactionClient;

const summarySelect = {
  id: true,
  code: true,
  type: true,
  name: true,
  normalizedName: true,
  businessRegistrationNumber: true,
  representativeName: true,
  phone: true,
  active: true,
  lockVersion: true,
  updatedAt: true,
  contacts: {
    where: { active: true, deletedAt: null },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, isPrimary: true },
  },
  sites: {
    where: { active: true, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, isDefault: true },
  },
} as const satisfies Prisma.CustomerSelect;

const detailSelect = {
  ...summarySelect,
  fax: true,
  email: true,
  website: true,
  postalCode: true,
  addressLine1: true,
  addressLine2: true,
  taxInvoiceEnabled: true,
  memo: true,
  contacts: {
    where: { deletedAt: null },
    orderBy: [
      { isPrimary: "desc" },
      { active: "desc" },
      { name: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      customerSiteId: true,
      name: true,
      department: true,
      title: true,
      phone: true,
      mobile: true,
      email: true,
      isPrimary: true,
      active: true,
      lockVersion: true,
      updatedAt: true,
    },
  },
  sites: {
    where: { deletedAt: null },
    orderBy: [
      { isDefault: "desc" },
      { active: "desc" },
      { name: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      code: true,
      name: true,
      phone: true,
      postalCode: true,
      addressLine1: true,
      addressLine2: true,
      memo: true,
      isDefault: true,
      active: true,
      lockVersion: true,
      updatedAt: true,
    },
  },
} as const satisfies Prisma.CustomerSelect;

type SummaryRow = Prisma.CustomerGetPayload<{ select: typeof summarySelect }>;
type DetailRow = Prisma.CustomerGetPayload<{ select: typeof detailSelect }>;

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function toSummary(row: SummaryRow): CustomerSummaryDto {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    name: row.name,
    businessRegistrationNumber: row.businessRegistrationNumber,
    representativeName: row.representativeName,
    phone: row.phone,
    active: row.active,
    lockVersion: row.lockVersion,
    contactCount: row.contacts.length,
    siteCount: row.sites.length,
    primaryContactName:
      row.contacts.find((contact) => contact.isPrimary)?.name ?? null,
    defaultSiteName: row.sites.find((site) => site.isDefault)?.name ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toContact(row: DetailRow["contacts"][number]): CustomerContactDto {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

function toSite(row: DetailRow["sites"][number]): CustomerSiteDto {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

function toDetail(row: DetailRow, duplicate: boolean): CustomerDetailDto {
  return {
    ...toSummary(row),
    fax: row.fax,
    email: row.email,
    website: row.website,
    postalCode: row.postalCode,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    taxInvoiceEnabled: row.taxInvoiceEnabled,
    memo: row.memo,
    businessRegistrationDuplicate: duplicate,
    contacts: row.contacts.map(toContact),
    sites: row.sites.map(toSite),
  };
}

function customerSnapshot(row: Pick<
  DetailRow,
  "code" | "type" | "name" | "businessRegistrationNumber" | "active" | "lockVersion"
>) {
  return {
    code: row.code,
    type: row.type,
    name: row.name,
    businessRegistrationNumber: row.businessRegistrationNumber,
    active: row.active,
    lockVersion: row.lockVersion,
  };
}

function contactSnapshot(customerId: string, row: CustomerContactDto) {
  return {
    customerId,
    customerSiteId: row.customerSiteId,
    name: row.name,
    isPrimary: row.isPrimary,
    active: row.active,
    lockVersion: row.lockVersion,
  };
}

function siteSnapshot(customerId: string, row: CustomerSiteDto) {
  return {
    customerId,
    code: row.code,
    name: row.name,
    isDefault: row.isDefault,
    active: row.active,
    lockVersion: row.lockVersion,
  };
}

function customerData(input: CustomerFields) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new CustomerError("INVALID_REQUEST", "거래처명을 입력해 주세요.");
  const businessRegistrationNumber = normalizeBusinessRegistrationNumber(
    input.businessRegistrationNumber,
  );
  if (businessRegistrationNumber && businessRegistrationNumber.length !== 10) {
    throw new CustomerError(
      "INVALID_REQUEST",
      "사업자등록번호는 숫자 10자리로 입력해 주세요.",
    );
  }
  return {
    type: input.type,
    name,
    normalizedName: normalizeCustomerName(name),
    businessRegistrationNumber,
    representativeName: normalizeOptionalText(input.representativeName),
    phone: normalizeOptionalText(input.phone),
    fax: normalizeOptionalText(input.fax),
    email: normalizeOptionalText(input.email)?.toLowerCase() ?? null,
    website: normalizeOptionalText(input.website),
    postalCode: normalizeOptionalText(input.postalCode),
    addressLine1: normalizeOptionalText(input.addressLine1),
    addressLine2: normalizeOptionalText(input.addressLine2),
    taxInvoiceEnabled: input.taxInvoiceEnabled,
    memo: normalizeOptionalText(input.memo),
  };
}

function contactData(input: CustomerContactFields) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new CustomerError("INVALID_REQUEST", "담당자명을 입력해 주세요.");
  return {
    customerSiteId: input.customerSiteId || null,
    name,
    department: normalizeOptionalText(input.department),
    title: normalizeOptionalText(input.title),
    phone: normalizeOptionalText(input.phone),
    mobile: normalizeOptionalText(input.mobile),
    email: normalizeOptionalText(input.email)?.toLowerCase() ?? null,
  };
}

function siteData(input: CustomerSiteFields) {
  const code = normalizeCustomerSiteCode(input.code);
  if (!isValidCustomerSiteCode(code)) {
    throw new CustomerError(
      "INVALID_REQUEST",
      "현장 코드는 영문 대문자·숫자·-·_ 조합 2~50자여야 합니다.",
    );
  }
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new CustomerError("INVALID_REQUEST", "현장명을 입력해 주세요.");
  return {
    code,
    name,
    phone: normalizeOptionalText(input.phone),
    postalCode: normalizeOptionalText(input.postalCode),
    addressLine1: normalizeOptionalText(input.addressLine1),
    addressLine2: normalizeOptionalText(input.addressLine2),
    memo: normalizeOptionalText(input.memo),
  };
}

async function lockCustomer(
  transaction: Transaction,
  organizationId: string,
  customerId: string,
): Promise<void> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Customer"
    WHERE "id" = ${customerId}::uuid AND "organizationId" = ${organizationId}::uuid
      AND "deletedAt" IS NULL
    FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new CustomerError("NOT_FOUND", "거래처를 찾을 수 없습니다.");
  }
}

async function getDetailRow(
  database: Database,
  organizationId: string,
  customerId: string,
): Promise<DetailRow> {
  const row = await database.customer.findFirst({
    where: { id: customerId, organizationId, deletedAt: null },
    select: detailSelect,
  });
  if (!row) throw new CustomerError("NOT_FOUND", "거래처를 찾을 수 없습니다.");
  return row;
}

async function hasBusinessRegistrationDuplicate(
  database: Database,
  organizationId: string,
  customerId: string,
  businessRegistrationNumber: string | null,
) {
  if (!businessRegistrationNumber) return false;
  return (
    (await database.customer.count({
      where: {
        organizationId,
        businessRegistrationNumber,
        id: { not: customerId },
        active: true,
        deletedAt: null,
      },
    })) > 0
  );
}

async function requireCustomerSite(
  database: Database,
  organizationId: string,
  customerId: string,
  customerSiteId: string | null,
): Promise<void> {
  if (!customerSiteId) return;
  const site = await database.customerSite.findFirst({
    where: {
      id: customerSiteId,
      organizationId,
      customerId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!site) {
    throw new CustomerError("NOT_FOUND", "담당자와 연결할 고객 현장을 찾을 수 없습니다.");
  }
}

export async function listCustomers(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    q?: string;
    type?: CustomerType;
    includeInactive?: boolean;
    cursor?: string;
    limit: number;
  },
): Promise<CustomerListDto> {
  requirePermission(context, "customer.read");
  let cursor: { normalizedName: string; id: string } | null;
  try {
    cursor = decodeCustomerCursor(input.cursor);
  } catch {
    throw new CustomerError("INVALID_REQUEST", "거래처 목록 페이지 위치가 올바르지 않습니다.");
  }
  const q = input.q?.trim() ?? "";
  const digits = q.replace(/\D/g, "");
  const andFilters: Prisma.CustomerWhereInput[] = [];
  if (q) {
    andFilters.push({
      OR: [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        ...(digits
          ? [
              { businessRegistrationNumber: { contains: digits } },
              { phone: { contains: digits } },
            ]
          : [{ phone: { contains: q, mode: "insensitive" as const } }]),
      ],
    });
  }
  if (cursor) {
    andFilters.push({
      OR: [
        { normalizedName: { gt: cursor.normalizedName } },
        { normalizedName: cursor.normalizedName, id: { gt: cursor.id } },
      ],
    });
  }
  const rows = await prisma.customer.findMany({
    where: {
      organizationId: context.organizationId,
      deletedAt: null,
      ...(input.includeInactive ? {} : { active: true }),
      ...(input.type ? { type: input.type } : {}),
      AND: andFilters,
    },
    orderBy: [{ normalizedName: "asc" }, { id: "asc" }],
    take: input.limit + 1,
    select: summarySelect,
  });
  const hasNext = rows.length > input.limit;
  const visible = hasNext ? rows.slice(0, input.limit) : rows;
  const last = visible.at(-1);
  return {
    items: visible.map(toSummary),
    nextCursor:
      hasNext && last ? encodeCustomerCursor(last.normalizedName, last.id) : null,
  };
}

export async function getCustomer(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  customerId: string,
): Promise<CustomerDetailDto> {
  requirePermission(context, "customer.read");
  const row = await getDetailRow(prisma, context.organizationId, customerId);
  const duplicate = await hasBusinessRegistrationDuplicate(
    prisma,
    context.organizationId,
    row.id,
    row.businessRegistrationNumber,
  );
  return toDetail(row, duplicate);
}

export async function createCustomer(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: CustomerFields & { requestId: string },
): Promise<CustomerDetailDto> {
  requirePermission(context, "customer.write");
  const data = customerData(input);
  return prisma.$transaction(async (transaction) => {
    const counter = await transaction.customerCodeCounter.upsert({
      where: { organizationId: context.organizationId },
      create: { organizationId: context.organizationId, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
      select: { nextValue: true },
    });
    let code: string;
    try {
      code = formatCustomerCode(counter.nextValue - 1);
    } catch {
      throw new CustomerError("CONFLICT", "거래처 자동 코드 범위를 초과했습니다.");
    }
    const created = await transaction.customer.create({
      data: { organizationId: context.organizationId, code, ...data },
      select: detailSelect,
    });
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "customer.created",
      entityId: created.id,
      requestId: input.requestId,
      after: customerSnapshot(created),
    });
    const duplicate = await hasBusinessRegistrationDuplicate(
      transaction,
      context.organizationId,
      created.id,
      created.businessRegistrationNumber,
    );
    return toDetail(created, duplicate);
  });
}

export async function updateCustomer(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: CustomerFields & {
    customerId: string;
    active: boolean;
    expectedLockVersion: number;
    requestId: string;
  },
): Promise<CustomerDetailDto> {
  requirePermission(context, "customer.write");
  const data = customerData(input);
  return prisma.$transaction(async (transaction) => {
    await lockCustomer(transaction, context.organizationId, input.customerId);
    const current = await getDetailRow(
      transaction,
      context.organizationId,
      input.customerId,
    );
    if (current.lockVersion !== input.expectedLockVersion) {
      throw new CustomerError(
        "CONFLICT",
        "거래처 정보가 변경되었습니다. 최신 정보를 불러온 뒤 다시 시도해 주세요.",
      );
    }
    await transaction.customer.update({
      where: { id: current.id },
      data: { ...data, active: input.active, lockVersion: { increment: 1 } },
    });
    const updated = await getDetailRow(
      transaction,
      context.organizationId,
      current.id,
    );
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "customer.updated",
      entityId: current.id,
      requestId: input.requestId,
      before: customerSnapshot(current),
      after: customerSnapshot(updated),
    });
    const duplicate = await hasBusinessRegistrationDuplicate(
      transaction,
      context.organizationId,
      updated.id,
      updated.businessRegistrationNumber,
    );
    return toDetail(updated, duplicate);
  });
}

export async function createCustomerContact(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: CustomerContactFields & { customerId: string; requestId: string },
): Promise<CustomerContactDto> {
  requirePermission(context, "customer.write");
  const data = contactData(input);
  return prisma.$transaction(async (transaction) => {
    await lockCustomer(transaction, context.organizationId, input.customerId);
    await requireCustomerSite(
      transaction,
      context.organizationId,
      input.customerId,
      data.customerSiteId,
    );
    const primary = await transaction.customerContact.findFirst({
      where: {
        organizationId: context.organizationId,
        customerId: input.customerId,
        isPrimary: true,
        active: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    const created = await transaction.customerContact.create({
      data: {
        organizationId: context.organizationId,
        customerId: input.customerId,
        ...data,
        isPrimary: !primary,
      },
      select: detailSelect.contacts.select,
    });
    const dto = toContact(created);
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "customer.contact_created",
      entityId: created.id,
      requestId: input.requestId,
      after: contactSnapshot(input.customerId, dto),
    });
    return dto;
  });
}

export async function updateCustomerContact(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: CustomerContactFields & {
    customerId: string;
    contactId: string;
    active: boolean;
    expectedLockVersion: number;
    requestId: string;
  },
): Promise<CustomerContactDto> {
  requirePermission(context, "customer.write");
  const data = contactData(input);
  return prisma.$transaction(async (transaction) => {
    await lockCustomer(transaction, context.organizationId, input.customerId);
    await requireCustomerSite(
      transaction,
      context.organizationId,
      input.customerId,
      data.customerSiteId,
    );
    const current = await transaction.customerContact.findFirst({
      where: {
        id: input.contactId,
        customerId: input.customerId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
      select: detailSelect.contacts.select,
    });
    if (!current) throw new CustomerError("NOT_FOUND", "담당자를 찾을 수 없습니다.");
    if (current.lockVersion !== input.expectedLockVersion) {
      throw new CustomerError("CONFLICT", "담당자 정보가 다른 화면에서 변경되었습니다.");
    }
    const updated = await transaction.customerContact.update({
      where: { id: current.id },
      data: {
        ...data,
        active: input.active,
        isPrimary: input.active ? current.isPrimary : false,
        lockVersion: { increment: 1 },
      },
      select: detailSelect.contacts.select,
    });
    const beforeDto = toContact(current);
    const updatedDto = toContact(updated);
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "customer.contact_updated",
      entityId: current.id,
      requestId: input.requestId,
      before: contactSnapshot(input.customerId, beforeDto),
      after: contactSnapshot(input.customerId, updatedDto),
    });
    return updatedDto;
  });
}

export async function setDefaultCustomerContact(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    customerId: string;
    contactId: string;
    expectedLockVersion: number;
    requestId: string;
  },
): Promise<CustomerContactDto> {
  requirePermission(context, "customer.write");
  return prisma.$transaction(async (transaction) => {
    await lockCustomer(transaction, context.organizationId, input.customerId);
    const target = await transaction.customerContact.findFirst({
      where: {
        id: input.contactId,
        customerId: input.customerId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
      select: detailSelect.contacts.select,
    });
    if (!target) throw new CustomerError("NOT_FOUND", "담당자를 찾을 수 없습니다.");
    if (target.lockVersion !== input.expectedLockVersion) {
      throw new CustomerError("CONFLICT", "담당자 정보가 다른 화면에서 변경되었습니다.");
    }
    if (!target.active) {
      throw new CustomerError("CONFLICT", "비활성 담당자는 기본 담당자로 지정할 수 없습니다.");
    }
    if (target.isPrimary) return toContact(target);
    const previous = await transaction.customerContact.findFirst({
      where: {
        organizationId: context.organizationId,
        customerId: input.customerId,
        isPrimary: true,
        active: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    await transaction.customerContact.updateMany({
      where: {
        organizationId: context.organizationId,
        customerId: input.customerId,
        isPrimary: true,
        deletedAt: null,
      },
      data: { isPrimary: false, lockVersion: { increment: 1 } },
    });
    const updated = await transaction.customerContact.update({
      where: { id: target.id },
      data: { isPrimary: true, lockVersion: { increment: 1 } },
      select: detailSelect.contacts.select,
    });
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "customer.contact_default_changed",
      entityId: target.id,
      requestId: input.requestId,
      before: { contactId: previous?.id ?? null },
      after: { contactId: target.id },
    });
    return toContact(updated);
  });
}

export async function createCustomerSite(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: CustomerSiteFields & { customerId: string; requestId: string },
): Promise<CustomerSiteDto> {
  requirePermission(context, "customer.write");
  const data = siteData(input);
  try {
    return await prisma.$transaction(async (transaction) => {
      await lockCustomer(transaction, context.organizationId, input.customerId);
      const currentDefault = await transaction.customerSite.findFirst({
        where: {
          organizationId: context.organizationId,
          customerId: input.customerId,
          isDefault: true,
          active: true,
          deletedAt: null,
        },
        select: { id: true },
      });
      const created = await transaction.customerSite.create({
        data: {
          organizationId: context.organizationId,
          customerId: input.customerId,
          ...data,
          isDefault: !currentDefault,
        },
        select: detailSelect.sites.select,
      });
      const dto = toSite(created);
      await writeAuditEvent(transaction, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "customer.site_created",
        entityId: created.id,
        requestId: input.requestId,
        after: siteSnapshot(input.customerId, dto),
      });
      return dto;
    });
  } catch (error) {
    if (isPrismaErrorCode(error, "P2002")) {
      throw new CustomerError("CONFLICT", "이미 사용 중인 고객 현장 코드입니다.");
    }
    throw error;
  }
}

export async function updateCustomerSite(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: CustomerSiteFields & {
    customerId: string;
    siteId: string;
    active: boolean;
    expectedLockVersion: number;
    requestId: string;
  },
): Promise<CustomerSiteDto> {
  requirePermission(context, "customer.write");
  const data = siteData(input);
  return prisma.$transaction(async (transaction) => {
    await lockCustomer(transaction, context.organizationId, input.customerId);
    const current = await transaction.customerSite.findFirst({
      where: {
        id: input.siteId,
        customerId: input.customerId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
      select: detailSelect.sites.select,
    });
    if (!current) throw new CustomerError("NOT_FOUND", "고객 현장을 찾을 수 없습니다.");
    if (current.lockVersion !== input.expectedLockVersion) {
      throw new CustomerError("CONFLICT", "고객 현장 정보가 다른 화면에서 변경되었습니다.");
    }
    if (data.code !== current.code) {
      throw new CustomerError("INVALID_REQUEST", "고객 현장 코드는 생성 후 변경할 수 없습니다.");
    }
    const updated = await transaction.customerSite.update({
      where: { id: current.id },
      data: {
        ...data,
        active: input.active,
        isDefault: input.active ? current.isDefault : false,
        lockVersion: { increment: 1 },
      },
      select: detailSelect.sites.select,
    });
    const beforeDto = toSite(current);
    const updatedDto = toSite(updated);
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "customer.site_updated",
      entityId: current.id,
      requestId: input.requestId,
      before: siteSnapshot(input.customerId, beforeDto),
      after: siteSnapshot(input.customerId, updatedDto),
    });
    return updatedDto;
  });
}

export async function setDefaultCustomerSite(
  prisma: PrismaClient,
  context: AuthenticatedContext,
  input: {
    customerId: string;
    siteId: string;
    expectedLockVersion: number;
    requestId: string;
  },
): Promise<CustomerSiteDto> {
  requirePermission(context, "customer.write");
  return prisma.$transaction(async (transaction) => {
    await lockCustomer(transaction, context.organizationId, input.customerId);
    const target = await transaction.customerSite.findFirst({
      where: {
        id: input.siteId,
        customerId: input.customerId,
        organizationId: context.organizationId,
        deletedAt: null,
      },
      select: detailSelect.sites.select,
    });
    if (!target) throw new CustomerError("NOT_FOUND", "고객 현장을 찾을 수 없습니다.");
    if (target.lockVersion !== input.expectedLockVersion) {
      throw new CustomerError("CONFLICT", "고객 현장 정보가 다른 화면에서 변경되었습니다.");
    }
    if (!target.active) {
      throw new CustomerError("CONFLICT", "비활성 고객 현장은 기본 현장으로 지정할 수 없습니다.");
    }
    if (target.isDefault) return toSite(target);
    const previous = await transaction.customerSite.findFirst({
      where: {
        organizationId: context.organizationId,
        customerId: input.customerId,
        isDefault: true,
        active: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    await transaction.customerSite.updateMany({
      where: {
        organizationId: context.organizationId,
        customerId: input.customerId,
        isDefault: true,
        deletedAt: null,
      },
      data: { isDefault: false, lockVersion: { increment: 1 } },
    });
    const updated = await transaction.customerSite.update({
      where: { id: target.id },
      data: { isDefault: true, lockVersion: { increment: 1 } },
      select: detailSelect.sites.select,
    });
    await writeAuditEvent(transaction, {
      organizationId: context.organizationId,
      actorUserId: context.userId,
      action: "customer.site_default_changed",
      entityId: target.id,
      requestId: input.requestId,
      before: { siteId: previous?.id ?? null },
      after: { siteId: target.id },
    });
    return toSite(updated);
  });
}
