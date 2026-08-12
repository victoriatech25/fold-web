import { redirect } from "next/navigation";
import { notFound } from "next/navigation";

import { requireAuthenticatedPage } from "@/server/auth/auth-dal";

export default async function AdminPage() {
  const context = await requireAuthenticatedPage();
  if (context.permissions.includes("admin.manage")) redirect("/admin/users");
  if (context.permissions.includes("master_data.read")) redirect("/admin/company");
  if (context.permissions.includes("audit.read")) redirect("/admin/audit-logs");
  notFound();
}
