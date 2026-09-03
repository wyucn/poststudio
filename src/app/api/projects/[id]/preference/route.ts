import { z } from "zod";
import { errorResponse, requireProjectViewer } from "@/lib/services";
import { setProjectFavorite } from "@/lib/projects/preferences";

const preferenceSchema = z.object({
  favorite: z.boolean(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { user } = await requireProjectViewer(id);
    const body = preferenceSchema.parse(await req.json());
    return Response.json(setProjectFavorite(user.id, id, body.favorite));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "参数错误" },
        { status: 400 }
      );
    }
    return errorResponse(error);
  }
}
