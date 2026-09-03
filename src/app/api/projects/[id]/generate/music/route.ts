/**
 * 音乐生成（Doubao-音乐生成插件，经 Coze MCP）。
 * - song：gen_song，提示词生成人声歌曲（自动写词）
 * - lyrics_song：lyrics_gen_song，按给定歌词成曲
 * - bgm：gen_bgm，纯音乐背景乐
 * 生成耗时 1-3 分钟，作为后台任务执行，完成后产物自动转存素材库。
 */
import { z } from "zod";
import {
  createTask,
  errorResponse,
  HttpError,
  requireProjectMember,
} from "@/lib/services";
import { BGM_DURATION, SONG_DURATION } from "@/lib/coze/plugins";
import {
  MUSIC_TEXT_LIMITS,
  musicTextLength,
  musicTextValidationMessage,
} from "@/lib/coze/music-limits";
import { assertManagedModelAvailable } from "@/lib/models/runtime";

const schema = z.object({
  mode: z.enum(["song", "lyrics_song", "bgm"]),
  /** song/bgm 的提示词，或 lyrics_song 的歌词 */
  // Keep a defensive envelope for oversized request bodies; the provider
  // specific 499/700 limits are enforced below with Unicode-aware counting.
  text: z.string().max(4096, "文本过长，请缩短后再提交"),
  duration: z.number().int(),
  gender: z.enum(["Male", "Female"]).optional(),
  genre: z.string().optional(),
  mood: z.string().optional(),
  timbre: z.string().optional(),
  instrument: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await requireProjectMember(id);
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const input = { ...parsed.data, text: parsed.data.text.trim() };
    const textMessage = musicTextValidationMessage(input.mode, input.text);
    if (textMessage) {
      const tooLong =
        musicTextLength(input.text) > MUSIC_TEXT_LIMITS[input.mode].max;
      throw new HttpError(
        400,
        textMessage,
        tooLong ? "MUSIC_TEXT_TOO_LONG" : "MUSIC_TEXT_TOO_SHORT"
      );
    }
    assertManagedModelAvailable("coze-music");

    const range = input.mode === "bgm" ? BGM_DURATION : SONG_DURATION;
    if (input.duration < range.min || input.duration > range.max) {
      throw new HttpError(400, `时长需在 ${range.min}-${range.max} 秒之间`);
    }

    const task = createTask({
      projectId: id,
      userId: user.id,
      kind: "music",
      modelKey: "coze-music",
      input: { prompt: input.text, ...input },
      status: "queued",
    });
    return Response.json({ task });
  } catch (e) {
    return errorResponse(e);
  }
}
