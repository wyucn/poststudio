/**
 * 图像创作预设：角色设定 / 场景设定。
 * 采用「设定资产」方案：用专业模板生成角色三视图设定表 / 场景概念图，
 * 资产 meta 打上 preset + presetName 标签，供流水线分镜引用，
 * 出首帧时自动作为参考图传给 Seedream 保证形象一致性。
 */

export type ImagePreset = "character" | "scene" | "style";

export interface PresetDef {
  label: string;
  /** 名称输入框提示 */
  namePlaceholder: string;
  /** 描述输入框提示 */
  descPlaceholder: string;
  /** 面板说明文案 */
  hint: string;
  buildPrompt(opts: { name: string; desc: string; hasRefs: boolean }): string;
}

export const IMAGE_PRESETS: Record<ImagePreset, PresetDef> = {
  character: {
    label: "角色设定",
    namePlaceholder: "角色名，如：小海豚阿宝",
    descPlaceholder:
      "描述角色的外形、年龄气质、发型服饰、配色、性格关键词……也可上传参考图提炼形象",
    hint: "生成角色三视图设定表（正/侧/背 + 面部与服饰细节），命名后可在流水线分镜中引用，保证各镜头角色形象一致。",
    buildPrompt({ name, desc, hasRefs }) {
      return [
        `专业角色设定图（character sheet）：角色「${name}」。${desc}`,
        hasRefs
          ? "以参考图中的形象为基准提炼角色，保留其核心辨识特征（脸型、发型、服饰、配色）。"
          : null,
        "画面要求：同一角色的全身三视图（正面、侧面、背面）在画面中横向排列，旁边附面部表情特写与关键服饰、道具细节小图；",
        "纯浅色平涂背景，无场景元素；三个视图中角色的发型、五官、服装、配色、体态严格一致；",
        "光线均匀柔和，轮廓与材质细节清晰；构图工整，类似动画美术设定稿；",
        "画面中不出现任何文字、标注、箭头或水印。",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
  scene: {
    label: "场景设定",
    namePlaceholder: "场景名，如：雨后霓虹屋顶",
    descPlaceholder:
      "描述场景的空间结构、时间天气、光线氛围、风格色调、关键陈设……也可上传参考图提炼场景",
    hint: "生成无人物的场景概念设定图，命名后可在流水线分镜中引用，保证各镜头环境与光线氛围一致。",
    buildPrompt({ name, desc, hasRefs }) {
      return [
        `专业场景概念设定图（environment concept art）：场景「${name}」。${desc}`,
        hasRefs
          ? "以参考图中的环境为基准进行概念化整理，保持空间结构、主要光源与氛围色调一致。"
          : null,
        "画面要求：无人物的空场景，广角全景构图，完整展示空间布局、纵深关系与主要光源方向；",
        "氛围色调统一，材质与细节丰富，可作为后续分镜的环境一致性参考；",
        "画面中不出现任何文字、标注或水印。",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
  style: {
    label: "风格设定",
    namePlaceholder: "风格名，如：赛博水墨",
    descPlaceholder:
      "描述色调倾向、光线处理、笔触 / 渲染质感、构图特点、时代或流派参考……也可上传参考图提炼风格",
    hint: "生成风格基调示意图（moodboard 式风格帧），命名后可在流水线分镜中挂载，全片色调与质感统一。",
    buildPrompt({ name, desc, hasRefs }) {
      return [
        `专业美术风格设定图（style frame / moodboard）：风格「${name}」。${desc}`,
        hasRefs
          ? "以参考图的视觉风格为基准提炼，保持其色调、笔触质感与光线处理方式。"
          : null,
        "画面要求：一张充分展示该风格的示意画面，包含环境一角、人物剪影与材质细节的组合呈现；",
        "色调、光线、笔触 / 渲染质感、颗粒与对比度处理在全画面内严格统一，风格特征鲜明可复制；",
        "画面中不出现任何文字、标注或水印。",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
};

export const PRESET_LABEL: Record<ImagePreset, string> = {
  character: "角色",
  scene: "场景",
  style: "风格",
};

export function isImagePreset(v: unknown): v is ImagePreset {
  return v === "character" || v === "scene" || v === "style";
}
