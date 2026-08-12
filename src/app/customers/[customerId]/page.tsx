import { notFound } from "next/navigation";
import { z } from "zod";

import { CustomerDetailPanel } from "@/components/customers/customer-detail-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { CustomerError } from "@/server/customers/customer-error";
import { getCustomer } from "@/server/customers/customer-service";
import { getPrisma } from "@/server/db/prisma";

const customerIdSchema = z.string().uuid();

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const auth = await requirePermissionPage("customer.read");
  const parsedId = customerIdSchema.safeParse((await params).customerId);
  if (!parsedId.success) notFound();

  let customer;
  try {
    customer = await getCustomer(getPrisma(), auth, parsedId.data);
  } catch (error) {
    if (error instanceof CustomerError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <CustomerDetailPanel
      canWrite={auth.permissions.includes("customer.write")}
      initial={customer}
    />
  );
}
