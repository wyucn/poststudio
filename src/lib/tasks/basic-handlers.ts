import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  assets,
  assetTranscripts,
  type Asset,
  type Task,
} from "@/db";
import { generateImageWithUsage } from "@/lib/ark/client";
import { callCozeTool, cozeData } from "@/lib/coze/client";
import { runtimeImageModel } from "@/lib/models/runtime";
import {
  bridgeCleanup,
  bridgeUploadImage,
} from "@/lib/coze/media-bridge";
import { bridgeReferenceAudio } from "@/lib/reference-audio";
import { TTS_VOICES, type MusicMode } from "@/lib/coze/plugins";
import {
  MUSIC_TEXT_LIMITS,
  isMusicTextLimitErrorMessage,
  musicTextLength,
  musicTextLimitMessage,
  musicTextValidationMessage,
} from "@/lib/coze/music-limits";
import { generateQwenVoiceClone } from "@/lib/modelscope/qwen-tts";
import {
  isQwenTtsInstanceKey,
} from "@/lib/modelscope/qwen-tts-runtime";
import {
  effectiveQwenTtsDefaultInstance,
  effectiveQwenTtsInstanceConfig,
} from "@/lib/models/runtime";
import { IMAGE_PRESETS } from "@/lib/presets";
import {
  HttpError,
  saveMediaAsset,
  saveMediaBufferAsset,
  updateTask,
} from "@/lib/services";
import { getObject, getObjectSize } from "@/lib/storage";
import { notifyPmAsset } from "@/lib/pm-callback";
import {
  AUDIO_TRANSCRIPTION_MODEL_KEY,
  downloadSubtitleText,
  plainTextFromSubtitle,
  subtitleUrlFromResult,
} from "@/lib/transcription";
import { notifyTaskDone } from "./notify";

type TaskInput = Record<string, unknown>;

function taskInput(task: Task): TaskInput {
  return JSON.parse(task.inputJson) as TaskInput;
}

function musicTextLimitError(
  mode: MusicMode | null,
  error: unknown
): HttpError | null {
  if (!mode) return null;
  const message = error instanceof Error ? error.message : String(error);
  return isMusicTextLimitErrorMessage(message)
    ? new HttpError(400, musicTextLimitMessage(mode), "MUSIC_TEXT_TOO_LONG")
    : null;
}

function imageRows(projectId: string, ids: string[], strict = true): Asset[] {
  if (!ids.length) return [];
  const found = db
    .select()
    .from(assets)
    .where(inArray(assets.id, ids))
    .all()
    .filter((asset) =>
      asset.projectId === projectId && asset.kind === "image" && asset.objectKey
    );
  if (strict && found.length !== ids.length) {
    throw new HttpError(400, "存在无效或已删除的参考图资产", "REFERENCE_IMAGE_INVALID");
  }
  return ids
    .map((id) => found.find((asset) => asset.id === id))
    .filter((asset): asset is Asset => !!asset);
}

async function bridgeImages(rows: Asset[]): Promise<{
  urls: string[];
  keys: string[];
}> {
  const urls: string[] = [];
  const keys: string[] = [];
  try {
    for (const row of rows) {
      const bridged = await bridgeUploadImage(row.objectKey!, row.mime);
      urls.push(bridged.url);
      keys.push(bridged.key);
    }
    return { urls, keys };
  } catch (error) {
    await bridgeCleanup(keys);
    throw error;
  }
}

async function runImageTask(task: Task) {
  const input = taskInput(task);
  const model = runtimeImageModel(task.modelKey);
  const cap = model.capability;
  const prompt = String(input.prompt ?? "");
  const size = String(input.size ?? cap.defaultTier);
  const refAssetIds = Array.isArray(input.refAssetIds)
    ? input.refAssetIds.map(String)
    : [];
  const preset =
    input.preset === "character" || input.preset === "scene" || input.preset === "style"
      ? input.preset
      : undefined;
  const presetName = typeof input.presetName === "string" ? input.presetName.trim() : "";
  const count = Math.max(1, Math.min(15, Number(input.count ?? 1)));
  const sequential = count > 1 && cap.supportsSequential;
  const webSearch = input.webSearch === true && cap.supportsWebSearch;
  const optimizeMode =
    input.optimizeMode === "fast" && cap.supportsFast ? "fast" : undefined;
  const outputFormat =
    (input.outputFormat === "png" || input.outputFormat === "jpeg") &&
    cap.supportsOutputFormat
      ? input.outputFormat
      : undefined;
  const finalPrompt = preset
    ? IMAGE_PRESETS[preset].buildPrompt({
        name: presetName,
        desc: prompt,
        hasRefs: refAssetIds.length > 0,
      })
    : prompt;
  const bridged = await bridgeImages(imageRows(task.projectId, refAssetIds));
  try {
    const generated = await generateImageWithUsage({
      endpointId: model.endpointId,
      apiKeyEnv: model.apiKeyEnv,
      prompt: finalPrompt,
      size,
      refImages: bridged.urls.length ? bridged.urls : undefined,
      stream: cap.supportsStream,
      sequential,
      maxImages: sequential ? count : undefined,
      webSearch,
      optimizeMode,
      outputFormat,
    });
    const results = generated.images;
    const saved = [];
    for (const result of results) {
      saved.push(
        await saveMediaAsset({
          projectId: task.projectId,
          userId: task.userId,
          kind: "image",
          remoteUrl: result.url,
          meta: {
            modelKey: model.key,
            modelName: model.modelName,
            prompt,
            params: {
              size,
              ratio: input.ratio,
              actualSize: result.size,
            },
            sourceAssetIds: refAssetIds,
            ...(preset ? { preset, presetName } : {}),
          },
          sourceTaskId: task.id,
        })
      );
    }
    updateTask(task.id, {
      status: "succeeded",
      outputAssetId: saved[0]?.id,
      usageJson: JSON.stringify({
        images: generated.usage?.generatedImages ?? saved.length,
        inputImages: generated.usage?.inputImages,
        outputTokens: generated.usage?.outputTokens,
        totalTokens: generated.usage?.totalTokens,
        webSearchCalls: generated.usage?.webSearchCalls,
        tools: generated.tools,
        source: "actual",
      }),
    });
    for (const s of saved) {
      void notifyPmAsset({
        postProjectId: task.projectId,
        assetId: s.id,
        kind: "image",
        prompt,
        thumbnailAssetId: s.id,
      });
    }
  } finally {
    await bridgeCleanup(bridged.keys);
  }
}

interface SongDetail {
  AudioUrl?: string;
  Lyrics?: string;
  Duration?: number;
  Genre?: string;
  Mood?: string;
}

async function runMusicTask(task: Task) {
  const input = taskInput(task);
  const mode = String(input.mode);
  const musicMode: MusicMode | null =
    mode === "song" || mode === "lyrics_song" || mode === "bgm" ? mode : null;
  const musicText = String(input.text ?? "").trim();
  if (musicMode) {
    const validationMessage = musicTextValidationMessage(musicMode, musicText);
    if (validationMessage) {
      const tooLong =
        musicTextLength(musicText) > MUSIC_TEXT_LIMITS[musicMode].max;
      throw new HttpError(
        400,
        validationMessage,
        tooLong ? "MUSIC_TEXT_TOO_LONG" : "MUSIC_TEXT_TOO_SHORT"
      );
    }
  }
  let toolName: string;
  const args: Record<string, unknown> = {};
  if (mode === "bgm") {
    toolName = "gen_bgm";
    args.Text = musicText;
    args.Duration = input.duration;
    if (input.genre) args.Genre = [input.genre];
    if (input.mood) args.Mood = [input.mood];
    if (input.instrument) args.Instrument = [input.instrument];
  } else {
    toolName = mode === "song" ? "gen_song" : "lyrics_gen_song";
    if (mode === "song") args.Prompt = musicText;
    else args.Lyrics = musicText;
    args.Duration = input.duration;
    if (input.gender) args.Gender = input.gender;
    if (input.genre) args.Genre = input.genre;
    if (input.mood) args.Mood = input.mood;
    if (input.timbre) args.Timbre = input.timbre;
  }
  let result: Awaited<ReturnType<typeof callCozeTool>>;
  try {
    result = await callCozeTool("music", toolName, args);
  } catch (error) {
    const limitError = musicTextLimitError(musicMode, error);
    if (limitError) throw limitError;
    throw error;
  }
  const data = cozeData(result);
  const failure = data.FailureReason as { Msg?: string } | undefined;
  if (failure?.Msg) {
    const limitError = musicTextLimitError(musicMode, failure.Msg);
    if (limitError) throw limitError;
    throw new Error(`生成失败: ${failure.Msg}`);
  }
  const detail = (data.SongDetail ?? {}) as SongDetail;
  if (!detail.AudioUrl) {
    const limitError = musicTextLimitError(
      musicMode,
      `${result.rawText}\n${JSON.stringify(data)}`
    );
    if (limitError) throw limitError;
    throw new Error("音乐生成未返回音频地址");
  }
  const asset = await saveMediaAsset({
    projectId: task.projectId,
    userId: task.userId,
    kind: "audio",
    remoteUrl: detail.AudioUrl,
    meta: {
      modelKey: "coze-music",
      modelName: "Doubao 音乐生成",
      prompt: musicText,
      params: {
        mode,
        duration: detail.Duration ?? input.duration,
        genre: detail.Genre ?? input.genre,
        mood: detail.Mood ?? input.mood,
        lyrics: detail.Lyrics,
      },
    },
    sourceTaskId: task.id,
  });
  updateTask(task.id, { status: "succeeded", outputAssetId: asset.id });
  // 音乐生成走 Coze 异步、耗时较长，用户常已切走，成功提醒
  notifyTaskDone(task, true);
  // 同步到制片工具管线视图（音频无缩略图）
  void notifyPmAsset({
    postProjectId: task.projectId,
    assetId: asset.id,
    kind: "audio",
    prompt: musicText,
  });
}

async function runTtsTask(task: Task) {
  const input = taskInput(task);
  const args: Record<string, unknown> = { text: input.text };
  if (input.voiceId) args.voice_id = input.voiceId;
  if (input.emotion) args.emotion = input.emotion;
  if (input.emotionScale) args.emotion_scale = input.emotionScale;
  if (input.speedRatio) args.speed_ratio = input.speedRatio;
  const result = await callCozeTool("tts", "speech_synthesis", args);
  const data = cozeData(result);
  const link = String(data.link ?? data.url ?? "");
  if (!link) throw new Error("语音合成未返回音频地址");
  const voiceName =
    TTS_VOICES.find((voice) => voice.id === input.voiceId)?.name ?? "默认音色";
  const asset = await saveMediaAsset({
    projectId: task.projectId,
    userId: task.userId,
    kind: "audio",
    remoteUrl: link,
    meta: {
      modelKey: "coze-tts",
      modelName: "豆包语音合成",
      prompt: String(input.text ?? ""),
      params: {
        voiceId: input.voiceId,
        voiceName,
        emotion: input.emotion,
        emotionScale: input.emotionScale,
        speedRatio: input.speedRatio,
        duration: data.duration,
      },
    },
    sourceTaskId: task.id,
  });
  updateTask(task.id, { status: "succeeded", outputAssetId: asset.id });
  // 配音走 Coze 异步、耗时较长，成功提醒
  notifyTaskDone(task, true);
  // 同步到制片工具管线视图（音频无缩略图）
  void notifyPmAsset({
    postProjectId: task.projectId,
    assetId: asset.id,
    kind: "audio",
    prompt: String(input.text ?? ""),
  });
}

async function runAudioTranscriptionTask(task: Task) {
  const input = taskInput(task);
  const sourceAssetId = String(input.sourceAssetId ?? "");
  const source = db
    .select()
    .from(assets)
    .where(eq(assets.id, sourceAssetId))
    .get();
  if (
    !source?.objectKey ||
    source.projectId !== task.projectId ||
    source.kind !== "audio"
  ) {
    throw new HttpError(
      400,
      "参考音频不存在、已删除或不属于当前项目",
      "TRANSCRIPTION_SOURCE_INVALID"
    );
  }

  const bridged = await bridgeReferenceAudio(source.objectKey, source.mime);
  try {
    const result = await callCozeTool(
      "videoEdit",
      "audio_to_subtitle",
      {
        source: bridged.url,
        subtitle_type: "srt",
        url_expire: 3600,
      },
      { configKey: AUDIO_TRANSCRIPTION_MODEL_KEY }
    );
    const data = cozeData(result);
    const subtitleUrl = subtitleUrlFromResult(data);
    if (!subtitleUrl) {
      throw new HttpError(
        502,
        "语音转写服务未返回字幕结果，请稍后重试。",
        "TRANSCRIPTION_RESULT_MISSING"
      );
    }
    const subtitleSrt = await downloadSubtitleText(subtitleUrl);
    const sourceText = plainTextFromSubtitle(subtitleSrt);
    if (!sourceText) {
      throw new HttpError(
        422,
        "没有识别到清晰语音，请确认音频包含单人、清楚的人声后重试。",
        "TRANSCRIPTION_EMPTY"
      );
    }

    const cached = db
      .select()
      .from(assetTranscripts)
      .where(eq(assetTranscripts.assetId, source.id))
      .get();
    if (!cached || cached.taskId !== task.id) {
      throw new HttpError(
        409,
        "转写任务已被新的请求替代，请刷新后查看最新结果。",
        "TRANSCRIPTION_TASK_SUPERSEDED"
      );
    }
    const saved = db
      .update(assetTranscripts)
      .set({
        sourceText,
        correctedText: cached.correctedText?.trim()
          ? cached.correctedText
          : sourceText,
        subtitleSrt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(assetTranscripts.assetId, source.id),
          eq(assetTranscripts.taskId, task.id)
        )
      )
      .run();
    if (!saved.changes) {
      throw new HttpError(
        409,
        "转写任务已被新的请求替代，请刷新后查看最新结果。",
        "TRANSCRIPTION_TASK_SUPERSEDED"
      );
    }

    const bill =
      data.bill_info && typeof data.bill_info === "object"
        ? (data.bill_info as Record<string, unknown>)
        : {};
    updateTask(task.id, {
      status: "succeeded",
      usageJson: JSON.stringify({
        durationSeconds: Number(bill.duration ?? 0) || undefined,
        billingRatio: Number(bill.ratio ?? 0) || undefined,
        source: "actual",
      }),
    });
  } finally {
    await bridgeCleanup([bridged.key]);
  }
}

async function runQwenVoiceCloneTask(task: Task) {
  const input = taskInput(task);
  const referenceAudioAssetId = String(input.referenceAudioAssetId ?? "");
  const reference = db
    .select()
    .from(assets)
    .where(inArray(assets.id, [referenceAudioAssetId]))
    .get();
  if (
    !reference?.objectKey ||
    reference.projectId !== task.projectId ||
    reference.kind !== "audio"
  ) {
    throw new HttpError(
      400,
      "参考音频不存在、已删除或不属于当前项目",
      "REFERENCE_AUDIO_INVALID"
    );
  }
  if ((await getObjectSize(reference.objectKey)) > 20 * 1024 * 1024) {
    throw new HttpError(
      413,
      "参考音频不能超过 20 MB，请先裁剪为短语音样本",
      "REFERENCE_AUDIO_TOO_LARGE"
    );
  }

  const useXVectorOnly = input.useXVectorOnly === true;
  const referenceText = String(input.referenceText ?? "").trim();
  if (!useXVectorOnly && !referenceText) {
    throw new HttpError(
      400,
      "高质量克隆需要填写参考音频的准确文本",
      "REFERENCE_AUDIO_TEXT_REQUIRED"
    );
  }

  const modelSize = input.modelSize === "0.6B" ? "0.6B" : "1.7B";
  const language = String(input.language ?? "Auto");
  const instance = isQwenTtsInstanceKey(input.instance)
    ? input.instance
    : effectiveQwenTtsDefaultInstance();
  const instanceConfig = effectiveQwenTtsInstanceConfig(instance);
  const result = await generateQwenVoiceClone({
    referenceAudio: await getObject(reference.objectKey),
    referenceText,
    targetText: String(input.text ?? ""),
    language,
    useXVectorOnly,
    modelSize,
    instance,
  });
  const asset = await saveMediaBufferAsset({
    projectId: task.projectId,
    userId: task.userId,
    kind: "audio",
    buffer: result.audio,
    mime: result.audioMime,
    meta: {
      modelKey: "modelscope-qwen3-tts",
      modelName: `Qwen3-TTS 声音克隆（${instanceConfig.label}）`,
      prompt: String(input.text ?? ""),
      sourceAssetIds: [reference.id],
      params: {
        referenceAudioAssetId: reference.id,
        referenceText,
        language,
        useXVectorOnly,
        modelSize,
        instance,
        status: result.status,
      },
    },
    sourceTaskId: task.id,
  });
  updateTask(task.id, { status: "succeeded", outputAssetId: asset.id });
  notifyTaskDone(task, true);
  void notifyPmAsset({
    postProjectId: task.projectId,
    assetId: asset.id,
    kind: "audio",
    prompt: String(input.text ?? ""),
  });
}

export async function executeBasicTask(task: Task): Promise<boolean> {
  if (task.kind === "text" && task.modelKey === AUDIO_TRANSCRIPTION_MODEL_KEY) {
    await runAudioTranscriptionTask(task);
    return true;
  }
  if (task.kind === "image") {
    await runImageTask(task);
    return true;
  }
  if (task.kind === "music") {
    await runMusicTask(task);
    return true;
  }
  if (task.kind === "audio" && task.modelKey === "coze-tts") {
    await runTtsTask(task);
    return true;
  }
  if (task.kind === "audio" && task.modelKey === "modelscope-qwen3-tts") {
    await runQwenVoiceCloneTask(task);
    return true;
  }
  return false;
}
