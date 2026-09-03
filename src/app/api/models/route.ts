import { managedModelPublicCatalog } from "@/lib/models/runtime";
import type { ManagedModelCatalogResponse } from "@/lib/models/contracts";
import { errorResponse, requireUser } from "@/lib/services";

export async function GET() {
  try {
    await requireUser();
    const body: ManagedModelCatalogResponse = {
      items: managedModelPublicCatalog(),
      generatedAt: new Date().toISOString(),
    };
    return Response.json(body, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
