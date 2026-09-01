import { UsageDashboard } from "@/components/usage-dashboard";
import { loadLocalDashboardInput } from "@/lib/local-data.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Page() {
  const input = await loadLocalDashboardInput();
  return <UsageDashboard input={input} />;
}
