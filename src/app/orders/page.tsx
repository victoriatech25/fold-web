import { SalesOrderStatus } from "@/generated/prisma/client";
import { OrderListPanel } from "@/components/orders/order-list-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { listCustomers } from "@/server/customers/customer-service";
import { getPrisma } from "@/server/db/prisma";
import { getOrderFormOptions, listOrdersPage } from "@/server/orders/order-service";

const knownStatuses = new Set<string>(Object.values(SalesOrderStatus));

/** 업무 홈에서 상태를 지정해 들어오는 링크를 받는다. 모르는 값은 조용히 버린다. */
function readStatuses(value: string | string[] | undefined): SalesOrderStatus[] {
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  return raw.split(",").filter((status) => knownStatuses.has(status)) as SalesOrderStatus[];
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requirePermissionPage("order.read");
  const statuses = readStatuses((await searchParams).statuses);
  const [orders, customers, options] = await Promise.all([
    listOrdersPage(getPrisma(), auth, { statuses }),
    listCustomers(getPrisma(), auth, { limit: 100 }),
    getOrderFormOptions(getPrisma(), auth),
  ]);

  return (
    <OrderListPanel
      canWrite={auth.permissions.includes("order.edit")}
      customers={customers.items.map((customer) => ({
        id: customer.id,
        code: customer.code,
        name: customer.name,
      }))}
      initial={orders}
      initialStatuses={statuses}
      owners={options.owners}
    />
  );
}
