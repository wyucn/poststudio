import { z } from "zod";
import type { ManagedModelAdminResponse } from "@/lib/models/contracts";
import {
  managedModelAdminCatalog,
  updateManagedModelConfig,
} from "@/lib/models/runtime";
import { errorResponse, HttpError, requireAdmin } from "@/lib/services";

const updateSchema = z.object({
  key: z.string().min(1),
  enabled: z.boolean(),
  endpoint: z.string().max(500).nullable(),
  capabilities: z.unknown().nullable(),
});

export async function GET() {
  try {
    await requireAdmin();
    const body: ManagedModelAdminResponse = {
      items: managedModelAdminCatalog(),
      generatedAt: new Date().toISOString(),
    };
    return Response.json(body, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireAdmin();
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      throw new HttpError(
        400,
        parsed.error.issues[0]?.message ?? "模型配置参数无效",
        "MODEL_CONFIG_INVALID"
      );
    }
    const body = parsed.data;
    return Response.json({
      item: updateManagedModelConfig({ ...body, updatedBy: user.id }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
