import { UsageDashboard } from "@/components/usage-dashboard";
import { loadLocalDashboardInputs } from "@/lib/local-data.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Page() {
  const inputs = await loadLocalDashboardInputs();
  return <UsageDashboard inputs={inputs} />;
}
