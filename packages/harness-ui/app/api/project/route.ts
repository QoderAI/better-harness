import { loadLocalDashboardProjectSnapshot } from "@/lib/local-data.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return Response.json({ error: { code: "PROJECT_REQUIRED", message: "A project id is required." } }, { status: 400 });
  }
  try {
    return Response.json(await loadLocalDashboardProjectSnapshot(id));
  } catch {
    return Response.json(
      { error: { code: "PROJECT_NOT_CONFIGURED", message: "The requested project is not configured." } },
      { status: 404 },
    );
  }
}
