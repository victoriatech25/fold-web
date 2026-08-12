import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/server/auth/auth-types";
import { PermissionDeniedError } from "@/server/authorization/authorization";
import { CustomerError } from "@/server/customers/customer-error";
import {
  createCustomer,
  createCustomerContact,
  createCustomerSite,
  getCustomer,
  listCustomers,
  setDefaultCustomerContact,
  setDefaultCustomerSite,
  updateCustomer,
  updateCustomerContact,
  updateCustomerSite,
} from "@/server/customers/customer-service";
import { disconnectPrisma, getPrisma } from "@/server/db/prisma";

const integration = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

let prisma: PrismaClient;
let organizationId: string;
let otherOrganizationId: string;
let context: AuthenticatedContext;

const customerFields = {
  type: "SALES" as const,
  name: "통합 테스트 거래처",
  businessRegistrationNumber: "123-45-67890",
  representativeName: "김대표",
  phone: "02-1234-5678",
  fax: null,
  email: "CUSTOMER@EXAMPLE.TEST",
  website: null,
  postalCode: "01234",
  addressLine1: "서울시 테스트구",
  addressLine2: null,
  taxInvoiceEnabled: true,
  memo: null,
};

integration.sequential("customer contacts and sites integration", () => {
  beforeAll(async () => {
    prisma = getPrisma();
    const organization = await prisma.organization.create({
      data: { code: "CUSTOMERS", name: "거래처 통합 조직" },
    });
    organizationId = organization.id;
    otherOrganizationId = (
      await prisma.organization.create({
        data: { code: "CUSTOMERS_OTHER", name: "다른 거래처 조직" },
      })
    ).id;
    const user = await prisma.user.create({
      data: {
        email: "customer-integration@example.test",
        normalizedEmail: "customer-integration@example.test",
        displayName: "거래처 관리자",
        status: "ACTIVE",
      },
    });
    context = {
      sessionId: crypto.randomUUID(),
      userId: user.id,
      displayName: user.displayName,
      membershipId: crypto.randomUUID(),
      departmentId: null,
      organizationId,
      organizationCode: organization.code,
      organizationName: organization.name,
      roleKeys: ["CUSTOMER_MANAGER"],
      permissions: ["customer.read", "customer.write"],
      expiresAt: new Date("2026-07-27T00:00:00.000Z"),
    };
  });

  afterAll(async () => disconnectPrisma());

  it("issues organization-scoped codes and warns about active duplicate registration numbers", async () => {
    const first = await createCustomer(prisma, context, {
      ...customerFields,
      requestId: "customer-create-1",
    });
    const second = await createCustomer(prisma, context, {
      ...customerFields,
      name: "두 번째 거래처",
      requestId: "customer-create-2",
    });
    expect(first.code).toBe("C000001");
    expect(second.code).toBe("C000002");
    expect(second.businessRegistrationDuplicate).toBe(true);

    const search = await listCustomers(prisma, context, {
      q: "1234567890",
      limit: 25,
    });
    expect(search.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
  });

  it("manages one default customer site and one primary contact", async () => {
    const customer = await createCustomer(prisma, context, {
      ...customerFields,
      name: "현장 담당자 테스트",
      businessRegistrationNumber: null,
      requestId: "customer-relations",
    });
    const firstSite = await createCustomerSite(prisma, context, {
      customerId: customer.id,
      code: " main ",
      name: "본 현장",
      phone: "031-111-2222",
      requestId: "site-create-main",
    });
    const secondSite = await createCustomerSite(prisma, context, {
      customerId: customer.id,
      code: "SITE-02",
      name: "제2현장",
      requestId: "site-create-second",
    });
    expect(firstSite).toMatchObject({ code: "MAIN", isDefault: true });
    expect(secondSite.isDefault).toBe(false);
    const newDefaultSite = await setDefaultCustomerSite(prisma, context, {
      customerId: customer.id,
      siteId: secondSite.id,
      expectedLockVersion: secondSite.lockVersion,
      requestId: "site-default-second",
    });
    expect(newDefaultSite.isDefault).toBe(true);

    const firstContact = await createCustomerContact(prisma, context, {
      customerId: customer.id,
      customerSiteId: firstSite.id,
      name: "첫 담당자",
      requestId: "contact-create-first",
    });
    const secondContact = await createCustomerContact(prisma, context, {
      customerId: customer.id,
      customerSiteId: secondSite.id,
      name: "두 번째 담당자",
      requestId: "contact-create-second",
    });
    expect(firstContact.isPrimary).toBe(true);
    expect(secondContact.isPrimary).toBe(false);
    const newPrimary = await setDefaultCustomerContact(prisma, context, {
      customerId: customer.id,
      contactId: secondContact.id,
      expectedLockVersion: secondContact.lockVersion,
      requestId: "contact-default-second",
    });
    expect(newPrimary.isPrimary).toBe(true);

    const detail = await getCustomer(prisma, context, customer.id);
    expect(detail.sites.filter((site) => site.isDefault)).toHaveLength(1);
    expect(detail.contacts.filter((contact) => contact.isPrimary)).toHaveLength(1);
  });

  it("enforces optimistic locking, inactive behavior, permission and organization boundaries", async () => {
    const customer = await createCustomer(prisma, context, {
      ...customerFields,
      name: "경계 조건 거래처",
      businessRegistrationNumber: null,
      requestId: "customer-boundary-create",
    });
    const updated = await updateCustomer(prisma, context, {
      ...customerFields,
      customerId: customer.id,
      name: "경계 조건 거래처 변경",
      businessRegistrationNumber: null,
      active: false,
      expectedLockVersion: customer.lockVersion,
      requestId: "customer-boundary-update",
    });
    expect(updated.active).toBe(false);
    await expect(
      updateCustomer(prisma, context, {
        ...customerFields,
        customerId: customer.id,
        active: true,
        expectedLockVersion: customer.lockVersion,
        requestId: "customer-stale-update",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await listCustomers(prisma, context, { limit: 25 })).items.some(
        (item) => item.id === customer.id,
      ),
    ).toBe(false);
    expect(
      (
        await listCustomers(prisma, context, {
          includeInactive: true,
          limit: 25,
        })
      ).items.some((item) => item.id === customer.id),
    ).toBe(true);

    await expect(
      listCustomers(prisma, { ...context, permissions: [] }, { limit: 25 }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    const otherCustomer = await prisma.customer.create({
      data: {
        organizationId: otherOrganizationId,
        code: "C000001",
        name: "다른 조직 거래처",
        normalizedName: "다른 조직 거래처",
      },
    });
    await expect(getCustomer(prisma, context, otherCustomer.id)).rejects.toBeInstanceOf(
      CustomerError,
    );
  });

  it("deactivates defaults without inventing a replacement", async () => {
    const customer = await createCustomer(prisma, context, {
      ...customerFields,
      name: "기본값 비활성 테스트",
      businessRegistrationNumber: null,
      requestId: "customer-inactive-defaults",
    });
    const site = await createCustomerSite(prisma, context, {
      customerId: customer.id,
      code: "ONLY",
      name: "유일 현장",
      requestId: "only-site",
    });
    const contact = await createCustomerContact(prisma, context, {
      customerId: customer.id,
      name: "유일 담당자",
      requestId: "only-contact",
    });
    const inactiveSite = await updateCustomerSite(prisma, context, {
      customerId: customer.id,
      siteId: site.id,
      code: site.code,
      name: site.name,
      active: false,
      expectedLockVersion: site.lockVersion,
      requestId: "only-site-inactive",
    });
    const inactiveContact = await updateCustomerContact(prisma, context, {
      customerId: customer.id,
      contactId: contact.id,
      name: contact.name,
      active: false,
      expectedLockVersion: contact.lockVersion,
      requestId: "only-contact-inactive",
    });
    expect(inactiveSite).toMatchObject({ active: false, isDefault: false });
    expect(inactiveContact).toMatchObject({ active: false, isPrimary: false });
    await expect(
      updateCustomerSite(prisma, context, {
        customerId: customer.id,
        siteId: inactiveSite.id,
        code: "CHANGED",
        name: inactiveSite.name,
        active: false,
        expectedLockVersion: inactiveSite.lockVersion,
        requestId: "site-code-immutable",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
