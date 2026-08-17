import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { OrderDetailPanel } from "@/components/orders/order-detail-panel"; import { OrderError } from "@/server/orders/order-error";
import { getOrder, getOrderFormOptions } from "@/server/orders/order-service";
import { listOrderFoldItems, listOrderFoldOptions } from "@/server/orders/order-fold-service";
import { getCurrentOrderCalculation } from "@/server/orders/order-calculation-service";
import { getOrderHistory } from "@/server/orders/order-history-service";
export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const auth = await requirePermissionPage("order.read");
  const id = (await params).orderId;
  if (!z.uuid().safeParse(id).success) notFound();
  let order;
  try {
    order = await getOrder(getPrisma(), auth, id);
  } catch (error) {
    if (error instanceof OrderError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const [options, initialFoldItems, foldOptions, initialCalculation, initialHistory] = await Promise.all([
    getOrderFormOptions(getPrisma(), auth),
    listOrderFoldItems(getPrisma(), auth, id),
    listOrderFoldOptions(getPrisma(), auth, { orderId: id }),
    getCurrentOrderCalculation(getPrisma(), auth, id),
    getOrderHistory(getPrisma(), auth, id),
  ]);
  return <OrderDetailPanel key={order.id} initial={order} options={options} initialFoldItems={initialFoldItems} foldOptions={foldOptions} initialCalculation={initialCalculation} initialHistory={initialHistory} canWrite={auth.permissions.includes("order.edit")} canApprove={auth.permissions.includes("order.approve")} />;
}
