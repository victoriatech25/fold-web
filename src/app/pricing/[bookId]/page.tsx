import { notFound } from "next/navigation";
import { z } from "zod";

import { PriceBookPanel } from "@/components/pricing/price-book-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { PricingError } from "@/server/pricing/pricing-error";
import { getPriceBookWorkspace } from "@/server/pricing/pricing-service";

type PriceBookPageProps = {
  params: Promise<{ bookId: string }>;
};

export default async function PriceBookPage({ params }: PriceBookPageProps) {
  const auth = await requirePermissionPage("pricing.read");
  const { bookId } = await params;
  if (!z.uuid().safeParse(bookId).success) notFound();
  let initial;
  try {
    initial = await getPriceBookWorkspace(getPrisma(), auth, bookId);
  } catch (error) {
    if (error instanceof PricingError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return <PriceBookPanel initial={initial} canWrite={auth.permissions.includes("pricing.write")} canApprove={auth.permissions.includes("pricing.approve")} />;
}
