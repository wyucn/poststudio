"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { SelectionIndicator } from "@/components/ui/selection-indicator";
import { StatusMessage } from "@/components/ui/status-message";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";
import { managedModel, useManagedModelCatalog } from "@/lib/client/models";
import {
  type TaskDto
} from "@/lib/client/types";
import {
  BGM_DURATION,
  BGM_GENRES,
  BGM_INSTRUMENTS,
  BGM_MOODS,
  MUSIC_MODE_LABEL,
  SONG_DURATION,
  SONG_GENRES,
  SONG_MOODS,
  SONG_TIMBRES,
  SONG_TIMBRE_LABEL,
  type MusicMode
} from "@/lib/coze/plugins";
import {
  MUSIC_TEXT_LIMITS,
  musicTextLength,
  musicTextLimitMessage,
  musicTextMinimumMessage,
} from "@/lib/coze/music-limits";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LayoutTemplate,
  Music,
  RotateCcw
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  type EmptyWorkspaceAction
} from "../empty-workspace-actions";
import { GenHistory } from "../gen-history";
import { useCanEdit } from "../read-only";
import {
  latestFailedCreatorTask,
  useCreatorTasks
} from "../use-creator-history";
import { CreationWorkspace } from "./creator-stage";
import {
  ComposerSteps,
  CreatorComposer,
  ParamSummary,
  StarterPrompts,
} from "./creator-workspace";

/* ---------------- 音乐（Coze Doubao 音乐生成） ---------------- */

export function MusicPanel({ projectId, projectName }: { projectId: string; projectName?: string }) {
  const qc = useQueryClient();
  const canEdit = useCanEdit();
  const modelCatalog = useManagedModelCatalog();
  const musicAvailable =
    managedModel(modelCatalog.data, "coze-music")?.enabled !== false;
  const { data: musicTasks } = useCreatorTasks(projectId, "music");
  const [mode, setMode] = useState<MusicMode>("song");
  const [text, setText] = useState("");
  const [duration, setDuration] = useState("60");
  const [gender, setGender] = useState("Female");
  const [genre, setGenre] = useState("none");
  const [mood, setMood] = useState("none");
  const [timbre, setTimbre] = useState("none");
  const [instrument, setInstrument] = useState("none");
  const [submitted, setSubmitted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isBgm = mode === "bgm";
  const textLimit = MUSIC_TEXT_LIMITS[mode];
  const normalizedText = text.trim();
  const textLength = musicTextLength(normalizedText);
  const textTooShort = textLength < textLimit.min;
  const textTooLong = textLength > textLimit.max;
  const range = isBgm ? BGM_DURATION : SONG_DURATION;
  const durations = useMemo(() => {
    const list: number[] = [];
    for (let s = range.min; s <= range.max; s += 30) list.push(s);
    return list;
  }, [range]);

  function switchMode(m: MusicMode) {
    setMode(m);
    setGenre("none");
    setMood("none");
    setTimbre("none");
    setInstrument("none");
    if (m === "bgm" && Number(duration) > BGM_DURATION.max) {
      setDuration(String(BGM_DURATION.max));
    }
  }

  const gen = useMutation({
    mutationFn: () =>
      api<{ task: TaskDto }>(`/api/projects/${projectId}/generate/music`, {
        method: "POST",
        json: {
          mode,
          text: normalizedText,
          duration: Number(duration),
          gender: isBgm ? undefined : gender,
          genre: genre === "none" ? undefined : genre,
          mood: mood === "none" ? undefined : mood,
          timbre: !isBgm && timbre !== "none" ? timbre : undefined,
          instrument: isBgm && instrument !== "none" ? instrument : undefined,
        },
      }),
    onSuccess: () => {
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["gen-history", projectId, "music"] });
    },
  });

  function reuse(input: Record<string, unknown>) {
    const m = (input.mode as MusicMode) ?? "song";
    switchMode(m);
    setText(String(input.text ?? ""));
    if (input.duration !== undefined) setDuration(String(input.duration));
    if (typeof input.gender === "string") setGender(input.gender);
    setGenre(typeof input.genre === "string" ? input.genre : "none");
    setMood(typeof input.mood === "string" ? input.mood : "none");
    setTimbre(typeof input.timbre === "string" ? input.timbre : "none");
    setInstrument(typeof input.instrument === "string" ? input.instrument : "none");
  }

  const failedMusicTask = latestFailedCreatorTask(musicTasks);
  const musicEmptyActions: EmptyWorkspaceAction[] = [
    {
      label: "背景音乐模板",
      detail: "为广告、短片和氛围场景配乐",
      icon: LayoutTemplate,
      onClick: () => {
        switchMode("bgm");
        setSettingsOpen(true);
      },
      disabled: !canEdit || !musicAvailable,
    },
    {
      label: "歌词成曲",
      detail: "粘贴歌词并按原文谱曲",
      icon: Music,
      onClick: () => switchMode("lyrics_song"),
      disabled: !canEdit || !musicAvailable,
    },
    ...(failedMusicTask
      ? [{
          label: "恢复最近失败",
          detail: failedMusicTask.task.error || "恢复上次输入与参数",
          icon: RotateCcw,
          tone: "recovery" as const,
          onClick: () => reuse(failedMusicTask.input),
        }]
      : []),
  ];

  return (
    <CreationWorkspace
      kind="music"
      index="MUSIC / 03"
      label="音乐创作"
      projectName={projectName}
      headline="先找到这一幕的节拍"
      description="把旋律、情绪和用途写下来，生成结果会直接回到左侧试听记录。"
      icon={Music}
      starters={
        <StarterPrompts
          items={[
            { label: "品牌主题曲", value: "一首明亮有力量的品牌主题曲，电子流行融合轻摇滚，节奏逐渐推进，适合年轻科技品牌" },
            { label: "温暖民谣", value: "关于夏日晚风和久别重逢的温暖民谣，木吉他与轻柔鼓点，旋律自然、真诚、有记忆点" },
            { label: "未来电子", value: "富有速度感的未来电子乐，清晰低频与层叠合成器，适合运动产品宣传片" },
          ]}
          onSelect={setText}
        />
      }
      actions={musicEmptyActions}
      history={
        <GenHistory
          projectId={projectId}
          kinds="music"
          resubmitPath={`/api/projects/${projectId}/generate/music`}
          onReuse={reuse}
          variant="sidebar"
        />
      }
      settings={{
        open: settingsOpen,
        onToggle: () => setSettingsOpen((value) => !value),
        onClose: () => setSettingsOpen(false),
        title: "音乐生成设置",
        description: "创作方式与常用参数保持在底部，曲风、情绪和音色在这里精细调整。",
        content: (
          <div className="space-y-6">
            <div>
              <p className="text-sm font-semibold">音乐方向</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">先选创作方式，再决定声音气质。</p>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(MUSIC_MODE_LABEL) as MusicMode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => switchMode(value)}
                  aria-pressed={mode === value}
                  className={`flex min-h-10 items-center justify-center gap-1 rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                    mode === value
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <SelectionIndicator selected={mode === value} className="size-3.5" />
                  {MUSIC_MODE_LABEL[value]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>时长</Label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger aria-label="音乐时长"><SelectValue /></SelectTrigger>
                  <SelectContent>{durations.map((value) => <SelectItem key={value} value={String(value)}>{value} 秒</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {!isBgm && (
                <div className="space-y-2">
                  <Label>演唱性别</Label>
                  <Select value={gender} onValueChange={setGender}>
                    <SelectTrigger aria-label="演唱性别"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="Female">女声</SelectItem><SelectItem value="Male">男声</SelectItem></SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>曲风</Label>
                <Select value={genre} onValueChange={setGenre}>
                  <SelectTrigger aria-label="音乐曲风"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">自动</SelectItem>
                    {(isBgm ? BGM_GENRES : SONG_GENRES).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>情绪</Label>
                <Select value={mood} onValueChange={setMood}>
                  <SelectTrigger aria-label="音乐情绪"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">自动</SelectItem>
                    {(isBgm ? BGM_MOODS : SONG_MOODS).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {!isBgm ? (
                <div className="col-span-2 space-y-2">
                  <Label>音色</Label>
                  <Select value={timbre} onValueChange={setTimbre}>
                    <SelectTrigger aria-label="演唱音色"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">自动</SelectItem>
                      {SONG_TIMBRES.map((value) => <SelectItem key={value} value={value}>{SONG_TIMBRE_LABEL[value] ?? value}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="col-span-2 space-y-2">
                  <Label>主奏乐器</Label>
                  <Select value={instrument} onValueChange={setInstrument}>
                    <SelectTrigger aria-label="主奏乐器"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">自动</SelectItem>
                      {BGM_INSTRUMENTS.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <ParamSummary>
              {MUSIC_MODE_LABEL[mode]} · {duration}s · {genre === "none" ? "自动曲风" : genre} · {mood === "none" ? "自动情绪" : mood}
            </ParamSummary>
          </div>
        ),
      }}
    >
      <CreatorComposer kind="music">
          <ComposerSteps finalLabel="生成音乐" />
          <div className="creation-compact-prompt px-4 pt-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Music className="size-3.5 text-primary" />
              <span>
                {mode === "lyrics_song"
                  ? "歌词（5-700 字）"
                  : isBgm
                    ? "背景音乐描述（中文，5-499 字）"
                    : "灵感提示词（中文，5-499 字）"}
              </span>
              <span className={textTooLong ? "ml-auto text-destructive" : "ml-auto text-muted-foreground"}>
                {textLength}/{textLimit.max} 字
              </span>
            </div>
            <Textarea
              aria-label={mode === "lyrics_song" ? "歌词" : "音乐提示词"}
              aria-invalid={textTooLong || undefined}
              rows={3}
              className="mt-1 min-h-20 resize-none border-0 bg-transparent px-0 text-base leading-7 shadow-none focus-visible:ring-0"
              placeholder={
                mode === "song"
                  ? "例如：一首关于深海与月光的歌，写给追梦的人……"
                  : mode === "lyrics_song"
                    ? "粘贴完整歌词，模型将按歌词精准成曲……"
                    : "例如：适合产品宣传片的轻快背景音乐……"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="creation-compact-toolbar">
            <Select value={mode} onValueChange={(value) => switchMode(value as MusicMode)}>
              <SelectTrigger aria-label="音乐创作模式" className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(MUSIC_MODE_LABEL) as MusicMode[]).map((value) => <SelectItem key={value} value={value}>{MUSIC_MODE_LABEL[value]}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger aria-label="音乐时长" className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{durations.map((value) => <SelectItem key={value} value={String(value)}>{value} 秒</SelectItem>)}</SelectContent>
            </Select>
            {!isBgm && (
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger aria-label="演唱性别" className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Female">女声</SelectItem><SelectItem value="Male">男声</SelectItem></SelectContent>
              </Select>
            )}
            <Select value={genre} onValueChange={setGenre}>
              <SelectTrigger aria-label="音乐曲风" className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">自动曲风</SelectItem>
                {(isBgm ? BGM_GENRES : SONG_GENRES).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              onClick={() => {
                setSubmitted(false);
                gen.mutate();
              }}
              disabled={!canEdit || !musicAvailable || textTooShort || textTooLong}
              loading={gen.isPending}
              loadingText="提交中"
              className="creation-primary-action ml-auto shrink-0 px-5"
            >
              <Music /> 生成音乐
            </Button>
          </div>
          {gen.isError && <StatusMessage tone="danger" appearance="strip">{gen.error.message}</StatusMessage>}
          {!musicAvailable && (
            <StatusMessage tone="info" appearance="strip">
              音乐生成已由管理员暂时下线，请稍后再试。
            </StatusMessage>
          )}
          {textTooLong && (
            <StatusMessage tone="danger" appearance="strip">
              {musicTextLimitMessage(mode)}
            </StatusMessage>
          )}
          {!textTooLong && textTooShort && (
            <p className="composer-ready-hint border-t border-border/55 px-4 py-2.5">
              {musicTextMinimumMessage(mode)}
            </p>
          )}
          {submitted && <StatusMessage tone="success" appearance="strip">任务已提交，可在左侧记录中查看进度。</StatusMessage>}
      </CreatorComposer>

    </CreationWorkspace>
  );
}
