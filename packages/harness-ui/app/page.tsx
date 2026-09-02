import { UsageDashboard } from "@/components/usage-dashboard";
import { listLocalDashboardProjects, loadLocalDashboardProjectSnapshot } from "@/lib/local-data.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Page() {
  const projects = listLocalDashboardProjects();
  const initialSnapshot = await loadLocalDashboardProjectSnapshot(projects[0].id);
  return <UsageDashboard projects={projects} initialSnapshot={initialSnapshot} />;
}
