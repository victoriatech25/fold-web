import { JobListPanel } from "@/components/jobs/job-list-panel";
import { requireAuthenticatedPage } from "@/server/auth/auth-dal";
import { getPrisma } from "@/server/db/prisma";
import { listJobs } from "@/server/jobs/job-service";

export default async function JobsPage() {
  const auth = await requireAuthenticatedPage();
  const initial = await listJobs(getPrisma(), auth, {});
  return <JobListPanel initial={initial} />;
}
