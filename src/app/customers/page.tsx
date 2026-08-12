import { CustomerListPanel } from "@/components/customers/customer-list-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { listCustomers } from "@/server/customers/customer-service";
import { getPrisma } from "@/server/db/prisma";

export default async function CustomersPage() {
  const auth = await requirePermissionPage("customer.read");
  const initialData = await listCustomers(getPrisma(), auth, { limit: 25 });

  return (
    <CustomerListPanel
      canWrite={auth.permissions.includes("customer.write")}
      initial={initialData}
    />
  );
}
