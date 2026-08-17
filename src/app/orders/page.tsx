import { OrderListPanel } from "@/components/orders/order-list-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { listCustomers } from "@/server/customers/customer-service";
import { getPrisma } from "@/server/db/prisma";
import { getOrderFormOptions, listOrdersPage } from "@/server/orders/order-service";
export default async function OrdersPage(){const auth=await requirePermissionPage("order.read");const [orders,customers,options]=await Promise.all([listOrdersPage(getPrisma(),auth,{}),listCustomers(getPrisma(),auth,{limit:100}),getOrderFormOptions(getPrisma(),auth)]);return <OrderListPanel initial={orders} customers={customers.items.map(x=>({id:x.id,code:x.code,name:x.name}))} owners={options.owners} canWrite={auth.permissions.includes("order.edit")}/>}
