"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  ALL_IMAGE_TIERS,
  IMAGE_RATIOS,
  formatPx,
  imageCap,
  imagePx,
  type ImageCapability,
  type ImageRatio,
  type ImageTier
} from "@/lib/ark/capabilities";
import { api } from "@/lib/client/api";
import {
  enabledManagedModels,
  managedCapabilities,
  useManagedModelCatalog,
} from "@/lib/client/models";
import {
  type AssetDto,
  type TaskDto
} from "@/lib/client/types";
import { IMAGE_PRESETS, isImagePreset, type ImagePreset } from "@/lib/presets";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileUp,
  Globe2,
  Image as ImageIcon,
  LayoutTemplate,
  LocateFixed,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2
} from "lucide-react";
import { useRef, useState } from "react";
import { AssetPicker } from "../asset-picker";
import {
  type EmptyWorkspaceAction
} from "../empty-workspace-actions";
import { GenHistory } from "../gen-history";
import {
  InteractiveEditCanvas,
  type Overlay as EditOverlay,
} from "../interactive-edit-canvas";
import { MentionTextarea, type MentionTextareaHandle } from "../mention-textarea";
import { ModelSelect } from "../model-select";
import { useCanEdit } from "../read-only";
import { ThumbStrip } from "../ref-chip";
import {
  latestFailedCreatorTask,
  useCreatorTasks
} from "../use-creator-history";
import { useAssetsByIds } from "../use-video-refs";
import { CreationWorkspace } from "./creator-stage";
import {
  ComposerSteps,
  CreatorComposer,
  ParamSummary,
  StarterPrompts,
} from "./creator-workspace";

/* ---------------- 图像 ---------------- */

export function ImagePanel({ projectId, projectName }: { projectId: string; projectName?: string }) {
  const qc = useQueryClient();
  const canEdit = useCanEdit();
  const modelCatalog = useManagedModelCatalog();
  const { data: imageTasks } = useCreatorTasks(projectId, "image");
  const fetchByIds = useAssetsByIds(projectId);
  const [prompt, setPrompt] = useState("");
  const [modelKeyPreference, setModelKeyRaw] = useState("seedream-5.0");
  const [tier, setTier] = useState<ImageTier>("2K");
  const [ratio, setRatio] = useState<ImageRatio>("16:9");
  const [refs, setRefs] = useState<AssetDto[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 创作类型：自由创作（空）/ 角色设定 / 场景设定 */
  const [preset, setPreset] = useState<"" | ImagePreset>("");
  const [presetName, setPresetName] = useState("");
  /** 组图张数（1 = 单图） */
  const [count, setCount] = useState(1);
  const [webSearch, setWebSearch] = useState(false);
  const [fastMode, setFastMode] = useState(false);
  const [outputFormat, setOutputFormat] = useState<"png" | "jpeg">("png");
  /** 提示词编辑器句柄（交互编辑标记芯片插入用） */
  const promptRef = useRef<MentionTextareaHandle>(null);
  /** 交互编辑画布标记（与编辑框芯片共享 id，删芯片自动移除对应框/点） */
  const [editOverlays, setEditOverlays] = useState<EditOverlay[]>([]);
  const [activeEditAssetId, setActiveEditAssetId] = useState<string | null>(null);
  const [selectedEditMarkId, setSelectedEditMarkId] = useState<number | null>(null);

  const availableImageModels = enabledManagedModels(modelCatalog.data, "image");
  const modelAvailable = !modelCatalog.data || availableImageModels.length > 0;
  const modelKey =
    modelCatalog.data &&
    !availableImageModels.some((model) => model.key === modelKeyPreference)
      ? (availableImageModels.find((model) => model.default)?.key ??
        availableImageModels[0]?.key ??
        modelKeyPreference)
      : modelKeyPreference;
  const capabilityFor = (key: string) =>
    managedCapabilities<ImageCapability>(
      modelCatalog.data,
      key,
      imageCap(key)
    );
  const cap = capabilityFor(modelKey);
  const px = imagePx(tier, ratio, modelKey);
  const presetDef = preset ? IMAGE_PRESETS[preset] : null;
  const resolvedActiveEditAssetId =
    refs.some((asset) => asset.id === activeEditAssetId)
      ? activeEditAssetId
      : refs[0]?.id ?? null;

  function removeEditMarks(markIds: number[]) {
    if (markIds.length === 0) return;
    const ids = new Set(markIds);
    setEditOverlays((current) => current.filter((overlay) => !ids.has(overlay.id)));
    setSelectedEditMarkId((current) => (current !== null && ids.has(current) ? null : current));
  }

  function removeRef(refId: string) {
    removeEditMarks(
      editOverlays
        .filter((overlay) => overlay.imageId === refId)
        .map((overlay) => overlay.id)
    );
    const nextRefs = refs.filter((asset) => asset.id !== refId);
    setRefs(nextRefs);
    if (activeEditAssetId === refId) setActiveEditAssetId(nextRefs[0]?.id ?? null);
  }

  // 切换模型时，自动回退不支持的档位与能力开关
  function setModelKey(key: string) {
    setModelKeyRaw(key);
    const next = capabilityFor(key);
    if (!next.tiers.includes(tier)) setTier(next.defaultTier);
    const nextRefs = refs.slice(0, next.maxRefImages);
    const retainedRefIds = new Set(nextRefs.map((asset) => asset.id));
    removeEditMarks(
      editOverlays
        .filter(
          (overlay) =>
            !next.supportsInteractiveEdit || !retainedRefIds.has(overlay.imageId)
        )
        .map((overlay) => overlay.id)
    );
    setRefs(nextRefs);
    if (
      activeEditAssetId &&
      !nextRefs.some((asset) => asset.id === activeEditAssetId)
    ) {
      setActiveEditAssetId(nextRefs[0]?.id ?? null);
    }
    if (!next.supportsSequential) setCount(1);
    if (!next.supportsWebSearch) setWebSearch(false);
    if (!next.supportsFast) setFastMode(false);
  }

  function addRef(a: AssetDto) {
    if (refs.some((asset) => asset.id === a.id) || refs.length >= cap.maxRefImages) {
      return;
    }
    setRefs((current) => [...current, a]);
    if (!resolvedActiveEditAssetId) setActiveEditAssetId(a.id);
  }

  // Pro 交互编辑：坐标标记芯片已直接嵌入 prompt 编辑框，序列化即含 图N<bbox> token
  const editEnabled = cap.supportsInteractiveEdit && refs.length > 0;
  const finalPrompt = prompt;

  const gen = useMutation({
    mutationFn: () =>
      api<{ task: TaskDto }>(`/api/projects/${projectId}/generate/image`, {
        method: "POST",
        json: {
          prompt: finalPrompt,
          modelKey,
          size: px,
          ratio,
          refAssetIds: refs.map((r) => r.id),
          preset: preset || undefined,
          presetName: preset ? presetName.trim() : undefined,
          count: cap.supportsSequential ? count : 1,
          webSearch: cap.supportsWebSearch ? webSearch : false,
          optimizeMode: cap.supportsFast && fastMode ? "fast" : undefined,
          outputFormat: cap.supportsOutputFormat ? outputFormat : undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["gen-history", projectId, "image"] });
    },
  });

  async function reuse(input: Record<string, unknown>) {
    const mk = String(input.modelKey ?? modelKey);
    setModelKey(mk);
    const r =
      typeof input.ratio === "string" &&
      (IMAGE_RATIOS as readonly string[]).includes(input.ratio)
        ? (input.ratio as ImageRatio)
        : ratio;
    setRatio(r);
    const size = String(input.size ?? "");
    const t = ALL_IMAGE_TIERS.find((x) => imagePx(x, r, mk) === size);
    if (t && capabilityFor(mk).tiers.includes(t)) setTier(t);
    setPrompt(String(input.prompt ?? ""));
    setPreset(isImagePreset(input.preset) ? input.preset : "");
    setPresetName(typeof input.presetName === "string" ? input.presetName : "");
    const reusedRefs = (await fetchByIds(input.refAssetIds)).slice(
      0,
      capabilityFor(mk).maxRefImages
    );
    setEditOverlays([]);
    setSelectedEditMarkId(null);
    setRefs(reusedRefs);
    setActiveEditAssetId(reusedRefs[0]?.id ?? null);
  }

  const busy = gen.isPending;
  const errorText = gen.isError ? gen.error.message : null;

  function renderImageEditInspector() {
    return (
      <div className="image-edit-inspector">
        <section className="image-edit-inspector-section">
          <div className="image-edit-inspector-heading">
            <div>
              <p className="text-sm font-semibold">生成参数</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatPx(px)} px · {ratio}
              </p>
            </div>
            <span className="image-edit-inspector-count">{tier}</span>
          </div>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>模型</Label>
              <ModelSelect
                kind="image"
                value={modelKey}
                onChange={setModelKey}
                ariaLabel="图像模型（交互编辑）"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>分辨率</Label>
                <Select value={tier} onValueChange={(value) => setTier(value as ImageTier)}>
                  <SelectTrigger aria-label="图像分辨率"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_IMAGE_TIERS.map((value) => (
                      <SelectItem key={value} value={value} disabled={!cap.tiers.includes(value)}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>画幅比例</Label>
                <Select value={ratio} onValueChange={(value) => setRatio(value as ImageRatio)}>
                  <SelectTrigger aria-label="图像画幅比例"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IMAGE_RATIOS.map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>创作类型</Label>
                <Select
                  value={preset || "free"}
                  onValueChange={(value) =>
                    setPreset(value === "free" ? "" : value as ImagePreset)
                  }
                >
                  <SelectTrigger aria-label="图像创作类型"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">自由创作</SelectItem>
                    <SelectItem value="character">角色设定</SelectItem>
                    <SelectItem value="scene">场景设定</SelectItem>
                    <SelectItem value="style">风格设定</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {cap.supportsOutputFormat && (
                <div className="space-y-2">
                  <Label>输出格式</Label>
                  <Select
                    value={outputFormat}
                    onValueChange={(value) => setOutputFormat(value as "png" | "jpeg")}
                  >
                    <SelectTrigger aria-label="图像输出格式"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="png">PNG</SelectItem>
                      <SelectItem value="jpeg">JPEG</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {cap.supportsFast && (
              <label className="image-edit-toggle">
                <span>
                  <b>极速模式</b>
                  <small>优先缩短提示词优化耗时</small>
                </span>
                <input
                  type="checkbox"
                  checked={fastMode}
                  onChange={(event) => setFastMode(event.target.checked)}
                />
              </label>
            )}
          </div>
        </section>

        <section className="image-edit-inspector-section is-marks">
          <div className="image-edit-inspector-heading">
            <div>
              <p className="text-sm font-semibold">标记列表</p>
              <p className="mt-1 text-xs text-muted-foreground">与提示词芯片双向同步</p>
            </div>
            <span className="image-edit-inspector-count">{editOverlays.length}</span>
          </div>
          <div className="image-edit-mark-list">
            {editOverlays.length ? (
              editOverlays.map((overlay, index) => (
                <div
                  key={overlay.id}
                  className={`image-edit-mark-row ${
                    selectedEditMarkId === overlay.id ? "is-selected" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="image-edit-mark-locate"
                    aria-pressed={selectedEditMarkId === overlay.id}
                    onClick={() => {
                      setActiveEditAssetId(overlay.imageId);
                      setSelectedEditMarkId(overlay.id);
                    }}
                    title="在画布中定位"
                  >
                    <span className="image-edit-mark-number">{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <b>{overlay.label}</b>
                      <small>{overlay.token.replace(/^图\d+/, "")}</small>
                    </span>
                    <SelectionIndicator
                      selected={selectedEditMarkId === overlay.id}
                      className="text-primary"
                    />
                    <LocateFixed />
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={() => removeEditMarks([overlay.id])}
                    title={`删除${overlay.label}`}
                    aria-label={`删除${overlay.label}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))
            ) : (
              <div className="image-edit-mark-empty">
                <LocateFixed />
                <p>尚未添加点选或框选标记</p>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  const failedImageTask = latestFailedCreatorTask(imageTasks);
  const imageEmptyActions: EmptyWorkspaceAction[] = [
    {
      label: "上传参考图",
      detail: "上传或从项目素材中选择",
      icon: FileUp,
      onClick: () => setPickerOpen(true),
      disabled: !canEdit,
    },
    {
      label: "选择创作模板",
      detail: "角色、场景与风格设定",
      icon: LayoutTemplate,
      onClick: () => setSettingsOpen(true),
    },
    ...(failedImageTask
      ? [{
          label: "恢复最近失败",
          detail: failedImageTask.task.error || "恢复上次输入与参数",
          icon: RotateCcw,
          tone: "recovery" as const,
          onClick: () => void reuse(failedImageTask.input),
        }]
      : []),
  ];

  return (
    <>
      <CreationWorkspace
        kind="image"
        index="IMAGE / 01"
        label="图片创作"
        projectName={projectName}
        headline="把画面先想清楚"
        description="描述主体、构图与质感；参考图和生成结果都会留在同一张创作桌上。"
        icon={ImageIcon}
        starters={
          <StarterPrompts
            items={[
              { label: "产品海报", value: "极简科技产品悬浮在暖灰色展台上，柔和侧光勾勒轮廓，大片留白，品牌广告质感" },
              { label: "电影场景", value: "雨夜城市街角，霓虹灯映在湿润路面，电影感宽画幅，细腻颗粒与层次丰富的光影" },
              { label: "角色设定", value: "年轻女性探险家角色设定图，正侧背三视图，实用主义服装，清晰材质与配色说明" },
            ]}
            onSelect={setPrompt}
          />
        }
        actions={imageEmptyActions}
        history={
          <GenHistory
            projectId={projectId}
            kinds="image"
            resubmitPath={`/api/projects/${projectId}/generate/image`}
            onReuse={(input) => void reuse(input)}
            variant="sidebar"
          />
        }
        stageContent={
          editEnabled ? (
            <InteractiveEditCanvas
              assets={refs}
              overlays={editOverlays}
              activeAssetId={resolvedActiveEditAssetId}
              selectedMarkId={selectedEditMarkId}
              onActiveAssetChange={setActiveEditAssetId}
              onSelectMark={setSelectedEditMarkId}
              onAddMark={(overlay, asset) => {
                setEditOverlays((current) => [...current, overlay]);
                promptRef.current?.insertMarkChip(
                  asset,
                  overlay.label,
                  overlay.token,
                  overlay.id
                );
              }}
              onUpdateMark={(overlay) =>
                setEditOverlays((current) =>
                  current.map((item) => (item.id === overlay.id ? overlay : item))
                )
              }
              onRemoveMark={(markId) => removeEditMarks([markId])}
            />
          ) : undefined
        }
        stageSidebar={editEnabled ? renderImageEditInspector() : undefined}
        settings={{
          open: settingsOpen,
          onToggle: () => setSettingsOpen((value) => !value),
          onClose: () => setSettingsOpen(false),
          title: editEnabled ? "参数与标记" : "图像生成设置",
          description: editEnabled
            ? "画布保持可见，这里只调整生成参数并管理标记。"
            : "画布保留常用参数，参考图、组图与模型扩展能力在这里按需调整。",
          content: editEnabled ? renderImageEditInspector() : (
            <div className="space-y-6">
              <div>
                <p className="text-sm font-semibold">创作配置</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  设置会即时同步到下方创作栏，不会打断提示词编辑。
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>创作类型</Label>
                  <Select
                    value={preset || "free"}
                    onValueChange={(value) => setPreset(value === "free" ? "" : value as ImagePreset)}
                  >
                    <SelectTrigger aria-label="图像创作类型"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">自由创作</SelectItem>
                      <SelectItem value="character">角色设定</SelectItem>
                      <SelectItem value="scene">场景设定</SelectItem>
                      <SelectItem value="style">风格设定</SelectItem>
                    </SelectContent>
                  </Select>
                  {presetDef && <p className="text-xs leading-5 text-muted-foreground">{presetDef.hint}</p>}
                </div>
                {presetDef && (
                  <div className="space-y-2">
                    <Label>{preset === "character" ? "角色名" : preset === "scene" ? "场景名" : "风格名"}</Label>
                    <Input
                      aria-label={preset === "character" ? "角色名" : preset === "scene" ? "场景名" : "风格名"}
                      value={presetName}
                      maxLength={30}
                      placeholder={presetDef.namePlaceholder}
                      onChange={(event) => setPresetName(event.target.value)}
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label>模型</Label>
                  <ModelSelect
                    kind="image"
                    value={modelKey}
                    onChange={setModelKey}
                    ariaLabel="图像模型（设置）"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>分辨率</Label>
                    <Select value={tier} onValueChange={(value) => setTier(value as ImageTier)}>
                      <SelectTrigger aria-label="图像分辨率"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ALL_IMAGE_TIERS.map((value) => (
                          <SelectItem key={value} value={value} disabled={!cap.tiers.includes(value)}>
                            {value} · {cap.tiers.includes(value) ? formatPx(imagePx(value, ratio, modelKey)) : "不支持"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>画幅比例</Label>
                    <Select value={ratio} onValueChange={(value) => setRatio(value as ImageRatio)}>
                      <SelectTrigger aria-label="图像画幅比例"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {IMAGE_RATIOS.map((value) => (
                          <SelectItem key={value} value={value}>{value} · {formatPx(imagePx(tier, value, modelKey))}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <ParamSummary>输出 {formatPx(px)} px · {ratio} · {tier}</ParamSummary>
              </div>

              <div className="space-y-3 border-t border-border/70 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">参考图</p>
                    <p className="mt-1 text-xs text-muted-foreground">最多 {cap.maxRefImages} 张</p>
                  </div>
                  {refs.length < cap.maxRefImages && (
                    <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                      <Plus /> 添加
                    </Button>
                  )}
                </div>
                <ThumbStrip
                  items={refs}
                  onRemove={removeRef}
                />
              </div>

              {(cap.supportsSequential || cap.supportsOutputFormat || cap.supportsFast || cap.supportsWebSearch) && (
                <div className="space-y-4 border-t border-border/70 pt-5">
                  <p className="text-sm font-semibold">输出选项</p>
                  <div className="grid grid-cols-2 gap-3">
                    {cap.supportsSequential && (
                      <div className="space-y-2">
                        <Label>生成张数</Label>
                        <Select value={String(count)} onValueChange={(value) => setCount(Number(value))}>
                          <SelectTrigger aria-label="图像生成张数"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5, 6].map((value) => (
                              <SelectItem key={value} value={String(value)}>{value === 1 ? "单图" : `${value} 张`}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {cap.supportsOutputFormat && (
                      <div className="space-y-2">
                        <Label>输出格式</Label>
                        <Select value={outputFormat} onValueChange={(value) => setOutputFormat(value as "png" | "jpeg")}>
                          <SelectTrigger aria-label="图像输出格式"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="png">PNG</SelectItem>
                            <SelectItem value="jpeg">JPEG</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="divide-y divide-border/70 border-y border-border/70">
                    {cap.supportsFast && (
                      <button
                        type="button"
                        aria-pressed={fastMode}
                        onClick={() => setFastMode((value) => !value)}
                        className="flex w-full items-center py-3 text-sm"
                      >
                        极速模式 <span className="ml-auto font-mono text-xs text-muted-foreground">{fastMode ? "ON" : "OFF"}</span>
                      </button>
                    )}
                    {cap.supportsWebSearch && (
                      <div>
                        <button
                          type="button"
                          aria-pressed={webSearch}
                          onClick={() => setWebSearch((value) => !value)}
                          className="flex w-full items-center py-3 text-sm"
                        >
                          <Globe2 className="mr-2 size-4" /> 联网搜索
                          <span className="ml-auto font-mono text-xs text-muted-foreground">{webSearch ? "ON" : "OFF"}</span>
                        </button>
                        {webSearch && (
                          <p className="pb-3 text-xs leading-5 text-muted-foreground">
                            模型自主决定是否搜索；公网资源每月前 2 万次免费，超出后公开价 4 元/千次。
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ),
        }}
      >
      <CreatorComposer kind="image">
          <ComposerSteps finalLabel="生成图片" />
          {presetDef && (
            <div className="creation-compact-inline border-b border-border/60 px-4 py-2.5">
              <Label className="shrink-0">{preset === "character" ? "角色名" : preset === "scene" ? "场景名" : "风格名"}</Label>
              <Input
                aria-label={preset === "character" ? "角色名" : preset === "scene" ? "场景名" : "风格名"}
                className="max-w-sm"
                value={presetName}
                maxLength={30}
                placeholder={presetDef.namePlaceholder}
                onChange={(event) => setPresetName(event.target.value)}
              />
            </div>
          )}
          <div className="creation-compact-prompt px-4 pt-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              {presetDef ? `${presetDef.label}描述` : "描述画面主体、构图、光线与质感"}
            </div>
            <MentionTextarea
              ref={promptRef}
              projectId={projectId}
              ariaLabel="图像提示词"
              rows={editEnabled ? 2 : 3}
              placeholder={
                presetDef?.descPlaceholder ??
                "描述画面主体、构图、光线、风格……（输入 @ 可引用素材库图片作参考）"
              }
              value={prompt}
              onChange={setPrompt}
              kinds={["image"]}
              onPick={addRef}
              marks={editOverlays}
              showHelp={!editEnabled}
              onMarkIdsChange={(ids) => {
                setEditOverlays((current) =>
                  current.filter((overlay) => ids.includes(overlay.id))
                );
                setSelectedEditMarkId((current) =>
                  current !== null && !ids.includes(current) ? null : current
                );
              }}
            />
          </div>
          {refs.length > 0 && !editEnabled && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2.5">
              <span className="text-xs font-medium text-muted-foreground">参考图</span>
              <ThumbStrip
                items={refs}
                onRemove={removeRef}
              />
            </div>
          )}
          <div className="creation-compact-toolbar">
            <ModelSelect
              kind="image"
              value={modelKey}
              onChange={setModelKey}
              ariaLabel="图像模型"
              className="min-w-44 flex-1 sm:max-w-64"
            />
            <Select value={preset || "free"} onValueChange={(value) => setPreset(value === "free" ? "" : value as ImagePreset)}>
              <SelectTrigger aria-label="图像创作类型" className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="free">自由创作</SelectItem>
                <SelectItem value="character">角色设定</SelectItem>
                <SelectItem value="scene">场景设定</SelectItem>
                <SelectItem value="style">风格设定</SelectItem>
              </SelectContent>
            </Select>
            <Select value={tier} onValueChange={(value) => setTier(value as ImageTier)}>
              <SelectTrigger aria-label="图像分辨率" className="w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_IMAGE_TIERS.map((value) => <SelectItem key={value} value={value} disabled={!cap.tiers.includes(value)}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={ratio} onValueChange={(value) => setRatio(value as ImageRatio)}>
              <SelectTrigger aria-label="图像画幅比例" className="w-20"><SelectValue /></SelectTrigger>
              <SelectContent>{IMAGE_RATIOS.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" className="shrink-0" onClick={() => setPickerOpen(true)}>
              <ImageIcon /> 参考图
            </Button>
            <Button
              onClick={() => gen.mutate()}
              disabled={!canEdit || !modelAvailable || !prompt.trim() || (!!preset && !presetName.trim())}
              loading={busy}
              loadingText="提交中"
              className="creation-primary-action ml-auto shrink-0 px-5"
            >
              <Sparkles /> {presetDef ? `生成${presetDef.label}图` : count > 1 ? `生成 ${count} 张` : "生成图像"}
            </Button>
          </div>
          {errorText && <StatusMessage tone="danger" appearance="strip">{errorText}</StatusMessage>}
          {!modelAvailable && <StatusMessage tone="info" appearance="strip">当前没有上线的图像模型，请联系管理员。</StatusMessage>}
          {!prompt.trim() && <p className="composer-ready-hint border-t border-border/55 px-4 py-2.5">先写一句画面描述，或点击舞台上的示例快速开始。</p>}
          {!!preset && !presetName.trim() && <p className="composer-ready-hint border-t border-border/55 px-4 py-2.5">当前是设定模式，还需要填写名称。</p>}
      </CreatorComposer>
      </CreationWorkspace>
      <AssetPicker
        projectId={projectId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={addRef}
        title="选择参考图"
      />
    </>
  );
}
