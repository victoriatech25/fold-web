import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { OrderDetailPanel } from "@/components/orders/order-detail-panel"; import { OrderError } from "@/server/orders/order-error";
import { getOrder, getOrderFormOptions } from "@/server/orders/order-service";
import { listOrderFoldItems, listOrderFoldOptions } from "@/server/orders/order-fold-service";
export default async function OrderDetailPage({params}:{params:Promise<{orderId:string}>}){const auth=await requirePermissionPage("order.read");const id=(await params).orderId;if(!z.uuid().safeParse(id).success)notFound();let order;try{order=await getOrder(getPrisma(),auth,id)}catch(e){if(e instanceof OrderError&&e.code==="NOT_FOUND")notFound();throw e}const [options,initialFoldItems,foldOptions]=await Promise.all([getOrderFormOptions(getPrisma(),auth),listOrderFoldItems(getPrisma(),auth,id),listOrderFoldOptions(getPrisma(),auth,{orderId:id})]);return <OrderDetailPanel key={order.id} initial={order} options={options} initialFoldItems={initialFoldItems} foldOptions={foldOptions} canWrite={auth.permissions.includes("order.edit")}/>}
