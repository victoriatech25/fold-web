import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { OrderDetailPanel } from "@/components/orders/order-detail-panel"; import { OrderError } from "@/server/orders/order-error";
import { getOrder } from "@/server/orders/order-service";
export default async function OrderDetailPage({params}:{params:Promise<{orderId:string}>}){const auth=await requirePermissionPage("order.read");const id=(await params).orderId;if(!z.uuid().safeParse(id).success)notFound();let order;try{order=await getOrder(getPrisma(),auth,id)}catch(e){if(e instanceof OrderError&&e.code==="NOT_FOUND")notFound();throw e}return <OrderDetailPanel initial={order} canWrite={auth.permissions.includes("order.edit")}/>}
