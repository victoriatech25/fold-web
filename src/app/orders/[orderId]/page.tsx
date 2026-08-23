import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { OrderDetailPanel } from "@/components/orders/order-detail-panel"; import { OrderError } from "@/server/orders/order-error";
import { getOrder, getOrderFormOptions } from "@/server/orders/order-service";
import { listOrderFoldItems, listOrderFoldOptions } from "@/server/orders/order-fold-service";
import { getCurrentOrderCalculation } from "@/server/orders/order-calculation-service";
import { getOrderHistory } from "@/server/orders/order-history-service";
import { listCuttingPlans } from "@/server/cutting/cutting-plan-service";
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
  // 재단 목록은 권한이 있을 때만 읽는다. 서비스가 권한을 다시 확인한다.
  const canOptimizeCutting = auth.permissions.includes("cutting.optimize");
  const initialCuttingPlans = canOptimizeCutting
    ? (await listCuttingPlans(getPrisma(), auth, { salesOrderId: id })).items
    : [];
  return <OrderDetailPanel key={order.id} initial={order} options={options} initialFoldItems={initialFoldItems} foldOptions={foldOptions} initialCalculation={initialCalculation} initialHistory={initialHistory} canWrite={auth.permissions.includes("order.edit")} canApprove={auth.permissions.includes("order.approve")} canOptimizeCutting={canOptimizeCutting} initialCuttingPlans={initialCuttingPlans} />;
}
