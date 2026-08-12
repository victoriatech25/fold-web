import { OrderListPanel } from "@/components/orders/order-list-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { listCustomers } from "@/server/customers/customer-service";
import { getPrisma } from "@/server/db/prisma";
import { listOrders } from "@/server/orders/order-service";
export default async function OrdersPage(){const auth=await requirePermissionPage("order.read");const [orders,customers]=await Promise.all([listOrders(getPrisma(),auth,{}),listCustomers(getPrisma(),auth,{limit:100})]);return <OrderListPanel initial={orders} customers={customers.items.map(x=>({id:x.id,code:x.code,name:x.name}))} canWrite={auth.permissions.includes("order.edit")}/>}
