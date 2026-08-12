import { ServiceShell } from "@/components/app-shell/service-shell";
import { FoldLibraryPanel } from "@/components/fold-library-panel";
import { requirePermissionPage } from "@/server/auth/auth-dal";

export const dynamic = "force-dynamic";

export default async function FoldLibraryPage() {
  const auth = await requirePermissionPage("template.fold.read");
  return (
    <ServiceShell
      displayName={auth.displayName}
      organizationName={auth.organizationName}
      pageDescription="분류·검색·검토·게시·개정 이력을 관리합니다."
      pageTitle="절곡 템플릿 라이브러리"
      permissions={auth.permissions}
      wide
    >
      <FoldLibraryPanel
        canEdit={auth.permissions.includes("template.fold.edit")}
        canPublish={auth.permissions.includes("template.fold.publish")}
      />
    </ServiceShell>
  );
}
