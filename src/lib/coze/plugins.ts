/**
 * Coze 插件能力注册表（前后端共用，不含密钥）。
 * 依据扣子官方文档：
 * - Doubao-音乐生成插件（gen_song / lyrics_gen_song / gen_bgm）
 * - 语音合成插件（speech_synthesis）
 * - 视频剪辑工具插件（22 个工具，本站接入常用 10 个）
 */

/* ======================== 音乐生成 ======================== */

export type MusicMode = "song" | "lyrics_song" | "bgm";

export const MUSIC_MODE_LABEL: Record<MusicMode, string> = {
  song: "灵感生曲",
  lyrics_song: "歌词成曲",
  bgm: "纯音乐 BGM",
};

/** 人声歌曲（gen_song / lyrics_gen_song）选项 */
export const SONG_GENRES = [
  "Folk", "Pop", "Rock", "Chinese Style", "Hip Hop/Rap", "R&B/Soul",
  "Punk", "Electronic", "Jazz", "Reggae", "DJ",
] as const;

export const SONG_MOODS = [
  "Happy", "Dynamic/Energetic", "Sentimental/Melancholic/Lonely",
  "Inspirational/Hopeful", "Nostalgic/Memory", "Excited", "Sorrow/Sad",
  "Chill", "Romantic",
] as const;

export const SONG_TIMBRES = [
  "Warm", "Bright", "Husky", "Electrified voice", "Sweet_AUDIO_TIMBRE",
  "Cute_AUDIO_TIMBRE", "Loud and sonorous", "Powerful", "Sexy/Lazy",
] as const;

export const SONG_TIMBRE_LABEL: Record<string, string> = {
  Warm: "温暖",
  Bright: "明亮",
  Husky: "沙哑",
  "Electrified voice": "电音",
  Sweet_AUDIO_TIMBRE: "甜美",
  Cute_AUDIO_TIMBRE: "可爱",
  "Loud and sonorous": "洪亮",
  Powerful: "有力",
  "Sexy/Lazy": "慵懒",
};

/** BGM（gen_bgm）选项 */
export const BGM_GENRES = [
  "cinematic", "epic", "upbeat", "chill out", "ambient", "corporate",
  "dance/edm", "electronic", "orchestral", "rock", "hip hop", "folk",
  "funk", "jazz", "pop", "acoustic", "soundtrack", "trailer", "documentary",
  "video game", "dark", "modern", "high tech", "holiday", "kids",
] as const;

export const BGM_MOODS = [
  "uplifting", "energetic", "happy", "calm", "dreamy", "dramatic",
  "peaceful", "playful", "powerful", "romantic", "intense", "emotional",
  "relaxed", "groovy", "reflective", "elegant", "mellow", "bright",
  "hopeful", "cool",
] as const;

export const BGM_INSTRUMENTS = [
  "piano", "guitar", "drums", "strings", "violin", "cello", "synth",
  "electric guitar", "acoustic guitar", "bass", "brass", "flute",
  "harp", "trumpet", "saxophone", "ukulele", "keyboard", "percussion",
] as const;

/** 歌曲时长（秒）：song 30-240，bgm 30-120 */
export const SONG_DURATION = { min: 30, max: 240 };
export const BGM_DURATION = { min: 30, max: 120 };

/* ======================== 语音合成 ======================== */

/** 豆包语音合成支持的情感枚举（speech_synthesis 的 emotion 取值） */
export type TtsEmotion =
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "fear"
  | "hate"
  | "excited"
  | "coldness"
  | "neutral";

/** 情感取值 → 中文显示名（与扣子官方「系统音色列表」一致） */
export const TTS_EMOTION_LABEL: Record<TtsEmotion, string> = {
  happy: "开心",
  sad: "悲伤",
  angry: "生气",
  surprised: "惊讶",
  fear: "恐惧",
  hate: "厌恶",
  excited: "激动",
  coldness: "冷漠",
  neutral: "中性",
};

/** 音色分组（场景），下拉按此分组展示 */
export type TtsGroup =
  | "general"
  | "roleplay"
  | "broadcast"
  | "audiobook"
  | "dialect"
  | "emotion"
  | "english"
  | "japanese";

export const TTS_GROUP_LABEL: Record<TtsGroup, string> = {
  general: "通用",
  roleplay: "角色扮演",
  broadcast: "播报解说",
  audiobook: "有声阅读",
  dialect: "趣味方言",
  emotion: "多情感",
  english: "英语",
  japanese: "日语",
};

/** 下拉展示顺序 */
export const TTS_GROUP_ORDER: TtsGroup[] = [
  "general",
  "emotion",
  "roleplay",
  "broadcast",
  "audiobook",
  "dialect",
  "english",
  "japanese",
];

export interface TtsVoice {
  id: string;
  name: string;
  /** 场景分组 */
  group: TtsGroup;
  /** 豆包语音合成大模型 2.0 音色（音质/拟人度更好，展示 2.0 标） */
  v2?: boolean;
  /**
   * 多情感音色支持的情感子集；存在该字段即表示支持 emotion 参数。
   * 重要：多情感音色会**严格校验**情感，传入不在此列表中的情感会报
   * `invalid emotion` 错误，因此前端情感下拉必须按此逐音色给选项。
   * （大模型 2.0 等非多情感音色虽不报错，但情感映射很弱，故不开放情感。）
   */
  emotions?: TtsEmotion[];
}

/**
 * 扣子系统音色精选（完整列表见扣子文档「系统音色列表」）。
 * 带 emotions 的为官方「多情感」音色，是真正支持情感参数的音色。
 */
export const TTS_VOICES: TtsVoice[] = [
  // ==== 通用 ====
  { id: "7426720361753903141", name: "爽快思思（默认）", group: "general" },
  { id: "7620288417930297386", name: "邻家女孩 2.0", group: "general", v2: true },
  { id: "7566481398970712100", name: "vivi", group: "general", v2: true },
  { id: "7568423452617506870", name: "大壹", group: "general", v2: true },
  { id: "7568423452617523254", name: "黑猫侦探社咪仔", group: "general", v2: true },
  { id: "7568423452617539638", name: "鸡汤女", group: "general", v2: true },
  { id: "7568423452617556022", name: "魅力女友", group: "general", v2: true },
  { id: "7568423452617572406", name: "流畅女声", group: "general", v2: true },
  { id: "7568423452617588790", name: "儒雅逸辰", group: "general", v2: true },
  { id: "7620302716920971318", name: "温柔女神", group: "general" },
  { id: "7426720361732980745", name: "少年梓辛", group: "general" },
  { id: "7426720361733144585", name: "邻家女孩", group: "general" },
  { id: "7426720361733177353", name: "渊博小叔", group: "general" },
  { id: "7426720361733193737", name: "阳光青年", group: "general" },
  { id: "7426720361753952293", name: "温暖阿虎", group: "general" },
  { id: "7426725529589596187", name: "甜美小源", group: "general" },
  { id: "7426725529589612571", name: "清澈梓梓", group: "general" },
  { id: "7426725529589645339", name: "解说小明", group: "general" },
  { id: "7426725529589661723", name: "开朗姐姐", group: "general" },
  { id: "7426725529589678107", name: "邻家男孩", group: "general" },
  { id: "7426725529589694491", name: "甜美悦悦", group: "general" },
  { id: "7426725529681657907", name: "心灵鸡汤", group: "general" },
  { id: "7468512265134768179", name: "灿灿", group: "general" },
  { id: "7468512265134899251", name: "知性女声", group: "general" },
  { id: "7468512265134915635", name: "清新女声", group: "general" },
  { id: "7468512265134981171", name: "邻家小妹", group: "general" },
  { id: "7468512265151610907", name: "清爽男大", group: "general" },
  { id: "7468512265151627291", name: "贴心女声", group: "general" },
  { id: "7468518753626521637", name: "知性温婉", group: "general" },
  { id: "7468518753626587173", name: "暖心体贴", group: "general" },
  { id: "7468518753626619941", name: "温柔文雅", group: "general" },
  { id: "7468518753626652709", name: "开朗轻快", group: "general" },
  { id: "7468518753626701861", name: "活泼爽朗", group: "general" },
  { id: "7468518846874288179", name: "率真小伙", group: "general" },
  { id: "7502012172269240359", name: "懒音绵宝", group: "general" },
  { id: "7534613951015845929", name: "暖阳女声", group: "general" },
  { id: "7539812934491619367", name: "灵动欣欣", group: "general" },
  { id: "7539813339484913700", name: "阳光洋洋", group: "general" },
  { id: "7539813339484946468", name: "秀丽倩倩", group: "general" },
  { id: "7568478038065709075", name: "Tina 老师", group: "general" },
  { id: "7559804070903611431", name: "元气甜妹", group: "general" },

  // ==== 多情感（emotion 参数的正主，逐音色支持的情感不同）====
  {
    id: "7524987545197772819",
    name: "高冷御姐（多情感）",
    group: "emotion",
    emotions: ["happy", "sad", "angry", "surprised", "fear", "hate", "excited", "coldness", "neutral"],
  },
  {
    id: "7524987545197821971",
    name: "柔美女友（多情感）",
    group: "emotion",
    emotions: ["happy", "sad", "angry", "surprised", "fear", "hate", "excited", "coldness", "neutral"],
  },
  {
    id: "7524987545197805587",
    name: "爽快思思（多情感）",
    group: "emotion",
    emotions: ["happy", "sad", "angry", "surprised", "excited", "coldness", "neutral"],
  },
  {
    id: "7524987545197903891",
    name: "阳光青年（多情感）",
    group: "emotion",
    emotions: ["happy", "sad", "angry", "fear", "excited", "coldness", "neutral"],
  },
  {
    id: "7524987545197871123",
    name: "儒雅男友（多情感）",
    group: "emotion",
    emotions: ["happy", "sad", "angry", "fear", "excited", "coldness", "neutral"],
  },
  {
    id: "7524987545197838355",
    name: "俊朗男友（多情感）",
    group: "emotion",
    emotions: ["happy", "sad", "angry", "surprised", "fear", "neutral"],
  },
  {
    id: "7524987545197936659",
    name: "优柔公子（多情感）",
    group: "emotion",
    emotions: ["happy", "sad", "angry", "fear", "hate", "excited", "neutral"],
  },
  {
    id: "7524987545197969427",
    name: "北京小爷（多情感）",
    group: "emotion",
    emotions: ["angry", "surprised", "fear", "excited", "coldness", "neutral"],
  },
  {
    id: "7524987545197953043",
    name: "京腔侃爷（多情感）",
    group: "emotion",
    emotions: ["happy", "angry", "surprised", "hate", "neutral"],
  },
  {
    id: "7524987545197789203",
    name: "邻居阿姨（多情感）",
    group: "emotion",
    emotions: ["coldness", "angry", "surprised", "neutral"],
  },
  {
    id: "7524987545197854739",
    name: "傲娇霸总（多情感）",
    group: "emotion",
    emotions: ["happy", "angry", "hate", "neutral"],
  },
  {
    id: "7524987545197887507",
    name: "甜心小美（多情感）",
    group: "emotion",
    emotions: ["sad", "fear", "hate", "neutral"],
  },
  {
    id: "7524987545197920275",
    name: "魅力女友（多情感）",
    group: "emotion",
    emotions: ["sad", "fear", "neutral"],
  },
  {
    id: "7524987545197756435",
    name: "广州德哥（多情感）",
    group: "emotion",
    emotions: ["angry", "fear", "neutral"],
  },
  // ==== 角色扮演 ====
  { id: "7619304808578809919", name: "撒娇学妹 2.0", group: "roleplay", v2: true },
  { id: "7568423452617605174", name: "可爱女生", group: "roleplay", v2: true },
  { id: "7568423452617621558", name: "调皮公主", group: "roleplay", v2: true },
  { id: "7568423452617637942", name: "爽朗少年", group: "roleplay", v2: true },
  { id: "7568423452617654326", name: "天才同桌", group: "roleplay", v2: true },
  { id: "7568423452617670710", name: "知性灿灿", group: "roleplay", v2: true },
  { id: "7426720361733013513", name: "魅力女友", group: "roleplay" },
  { id: "7426720361733029897", name: "深夜播客", group: "roleplay" },
  { id: "7426720361733046281", name: "柔美女友", group: "roleplay" },
  { id: "7426720361733062665", name: "撒娇学妹", group: "roleplay" },
  { id: "7426720361733160969", name: "高冷御姐", group: "roleplay" },
  { id: "7426720361733210121", name: "傲娇霸总", group: "roleplay" },
  { id: "7426725529589514267", name: "病弱少女", group: "roleplay" },
  { id: "7426725529589530651", name: "活泼女孩", group: "roleplay" },
  { id: "7426725529589547035", name: "和蔼奶奶", group: "roleplay" },
  { id: "7426725529589563419", name: "邻居阿姨", group: "roleplay" },
  { id: "7426725529589579803", name: "温柔小雅", group: "roleplay" },
  { id: "7426725529589628955", name: "东方浩然", group: "roleplay" },
  { id: "7468512265134817331", name: "天才童声", group: "roleplay" },
  { id: "7468512265134833715", name: "奶气萌娃", group: "roleplay" },
  { id: "7468512265134850099", name: "猴哥", group: "roleplay" },
  { id: "7468512265134866483", name: "熊二", group: "roleplay" },
  { id: "7468512265134882867", name: "佩奇猪", group: "roleplay" },
  { id: "7468512265134948403", name: "婆婆", group: "roleplay" },
  { id: "7468512265134964787", name: "武则天", group: "roleplay" },
  { id: "7468512265151463451", name: "少儿故事", group: "roleplay" },
  { id: "7468512265151479835", name: "四郎", group: "roleplay" },
  { id: "7468512265151496219", name: "顾姐", group: "roleplay" },
  { id: "7468512265151512603", name: "樱桃丸子", group: "roleplay" },
  { id: "7468512265151660059", name: "俏皮女声", group: "roleplay" },
  { id: "7468512265151676443", name: "萌丫头", group: "roleplay" },
  { id: "7468518753626538021", name: "绿茶小哥", group: "roleplay" },
  { id: "7468518753626554405", name: "娇弱萝莉", group: "roleplay" },
  { id: "7468518753626570789", name: "冷淡疏离", group: "roleplay" },
  { id: "7468518753626603557", name: "憨厚敦实", group: "roleplay" },
  { id: "7468518753626636325", name: "傲气凌人", group: "roleplay" },
  { id: "7468518753626669093", name: "活泼刁蛮", group: "roleplay" },
  { id: "7468518753626685477", name: "固执病娇", group: "roleplay" },
  { id: "7468518753626718245", name: "撒娇粘人", group: "roleplay" },
  { id: "7468518753626734629", name: "傲慢娇声", group: "roleplay" },
  { id: "7468518753626751013", name: "潇洒随性", group: "roleplay" },
  { id: "7468518753626767397", name: "腹黑公子", group: "roleplay" },
  { id: "7468518753626783781", name: "诡异神秘", group: "roleplay" },
  { id: "7468518753626800165", name: "儒雅才俊", group: "roleplay" },
  { id: "7468518846874255411", name: "病娇白莲", group: "roleplay" },
  { id: "7468518846874271795", name: "正直青年", group: "roleplay" },
  { id: "7468518846874304563", name: "娇憨女王", group: "roleplay" },
  { id: "7468518846874320947", name: "病娇萌妹", group: "roleplay" },
  { id: "7468518846874337331", name: "青涩小生", group: "roleplay" },
  { id: "7468518846874353715", name: "纯真学弟", group: "roleplay" },
  { id: "7468518846874370099", name: "暖心学姐", group: "roleplay" },
  { id: "7468518846874386483", name: "可爱女生", group: "roleplay" },
  { id: "7468518846874402867", name: "成熟姐姐", group: "roleplay" },
  { id: "7468518846874419251", name: "病娇姐姐", group: "roleplay" },
  { id: "7468518846874435635", name: "优柔帮主", group: "roleplay" },
  { id: "7468518846874452019", name: "优柔公子", group: "roleplay" },
  { id: "7468518846874468403", name: "妩媚御姐", group: "roleplay" },
  { id: "7468518846874484787", name: "调皮公主", group: "roleplay" },
  { id: "7468518846874501171", name: "傲娇女友", group: "roleplay" },
  { id: "7468518846874517555", name: "贴心男友", group: "roleplay" },
  { id: "7468518846874533939", name: "少年将军", group: "roleplay" },
  { id: "7468518846874550323", name: "贴心女友", group: "roleplay" },
  { id: "7468518846874566707", name: "病娇哥哥", group: "roleplay" },
  { id: "7468518920446541862", name: "学霸男同桌", group: "roleplay" },
  { id: "7468518920446558246", name: "幽默叔叔", group: "roleplay" },
  { id: "7468518920446574630", name: "性感御姐", group: "roleplay" },
  { id: "7468518920446591014", name: "假小子", group: "roleplay" },
  { id: "7468518920446607398", name: "冷峻上司", group: "roleplay" },
  { id: "7468518920446623782", name: "温柔男同桌", group: "roleplay" },
  { id: "7468518920446640166", name: "病娇弟弟", group: "roleplay" },
  { id: "7468518920446656550", name: "幽默大爷", group: "roleplay" },
  { id: "7468518920446672934", name: "傲慢少爷", group: "roleplay" },
  { id: "7468518920446689318", name: "神秘法师", group: "roleplay" },

  // ==== 播报解说 ====
  { id: "7468512265134932019", name: "悬疑解说", group: "broadcast" },
  { id: "7468512265151528987", name: "磁性解说男声", group: "broadcast" },
  { id: "7468512265151561755", name: "鸡汤妹妹", group: "broadcast" },
  { id: "7468512265151594523", name: "广告解说", group: "broadcast" },

  // ==== 有声阅读 ====
  { id: "7468512265151709211", name: "儒雅青年", group: "audiobook" },
  { id: "7468512265151725595", name: "霸气青叔", group: "audiobook" },
  { id: "7468512265151741979", name: "擎苍", group: "audiobook" },
  { id: "7468512265151758363", name: "活力小哥", group: "audiobook" },
  { id: "7468518753626488869", name: "古风少御", group: "audiobook" },
  { id: "7468518753626505253", name: "温柔淑女", group: "audiobook" },

  // ==== 趣味方言 ====
  { id: "7426720361732915209", name: "湾区大叔", group: "dialect" },
  { id: "7426720361732931593", name: "呆萌川妹", group: "dialect" },
  { id: "7426720361732947977", name: "广州德哥", group: "dialect" },
  { id: "7426720361732964361", name: "北京小爷", group: "dialect" },
  { id: "7426720361733079049", name: "浩宇小哥", group: "dialect" },
  { id: "7426720361733095433", name: "广西远舟", group: "dialect" },
  { id: "7426720361733111817", name: "妹坨洁儿", group: "dialect" },
  { id: "7426720361733128201", name: "豫州子轩", group: "dialect" },
  { id: "7426720361753870373", name: "京腔侃爷", group: "dialect" },
  { id: "7426720361753968677", name: "湾湾小何", group: "dialect" },
  { id: "7566932564049428534", name: "粤语小溏（粤语）", group: "dialect" },

  // ==== 英语 ====
  { id: "7426720361753935909", name: "Alvin（美式）", group: "english" },
  { id: "7426720361732997129", name: "Brayan（美式）", group: "english" },
  { id: "7426720361753919525", name: "Skye（美式）", group: "english" },
  { id: "7468512265134784563", name: "Shiny（美式）", group: "english" },
  { id: "7468512265151447067", name: "Lily（美式）", group: "english" },
  { id: "7468512265151643675", name: "Candy（美式）", group: "english" },
  { id: "7496857918554243113", name: "Adam（美式）", group: "english" },
  { id: "7496857918554259497", name: "Sarah（澳洲）", group: "english" },
  { id: "7496857918554275881", name: "Dryw（澳洲）", group: "english" },
  { id: "7496857918554292265", name: "Smith（英式）", group: "english" },
  { id: "7496857918554308649", name: "Amanda（美式）", group: "english" },
  { id: "7426720361753886757", name: "Harmony（美式）", group: "english" },
  { id: "7468512265134800947", name: "Anna（英式）", group: "english" },
  { id: "7468512265151545371", name: "Morgan（美式）", group: "english" },
  { id: "7468512265151578139", name: "Hope（美式）", group: "english" },
  { id: "7468512265151692827", name: "Cutey（美式）", group: "english" },

  // ==== 日语 ====
  { id: "7426720361754050597", name: "あけみ（朱美）", group: "japanese" },
  { id: "7426720361754017829", name: "かずね（和音）", group: "japanese" },
  { id: "7426720361753985061", name: "はるこ（晴子）", group: "japanese" },
  { id: "7426720361754066981", name: "ひろし（広志）", group: "japanese" },
];

/** 输入文本上限：1024 字节 ≈ 340 个汉字 */
export const TTS_MAX_CHARS = 340;

/* ======================== 剪辑工具 ======================== */

export type EditFieldType =
  | "video"        // 单个视频素材
  | "audio"        // 单个音频素材
  | "media"        // 视频或音频素材
  | "videos"       // 多个视频素材
  | "images"       // 多张图片素材
  | "audios"       // 多个音频素材
  | "number"
  | "select"
  | "boolean";

export interface EditField {
  key: string;
  label: string;
  type: EditFieldType;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean;
  help?: string;
}

export interface EditToolDef {
  key: string;
  label: string;
  description: string;
  /** 输出产物类型 */
  outputKind: "video" | "audio";
  /** 处理大约耗时提示 */
  slow?: boolean;
  fields: EditField[];
}

export const EDIT_TOOLS: EditToolDef[] = [
  {
    key: "video_trim",
    label: "视频裁剪",
    description: "保留指定时间段的视频内容",
    outputKind: "video",
    fields: [
      { key: "video", label: "视频", type: "video", required: true },
      { key: "start_time", label: "开始时间（秒）", type: "number", min: 0, step: 0.01, defaultValue: 0 },
      { key: "end_time", label: "结束时间（秒，留空到结尾）", type: "number", min: 0, step: 0.01 },
    ],
  },
  {
    key: "concat_videos",
    label: "视频拼接",
    description: "按顺序拼接多个视频（总时长建议 5 分钟内）",
    outputKind: "video",
    fields: [
      { key: "videos", label: "视频列表（按拼接顺序）", type: "videos", required: true },
    ],
  },
  {
    key: "compile_video_audio",
    label: "音视频合成",
    description: "为视频配上音频（配乐 / 配音），可选时长对齐",
    outputKind: "video",
    fields: [
      { key: "video", label: "视频", type: "video", required: true },
      { key: "audio", label: "音频", type: "audio", required: true },
      { key: "is_audio_reserve", label: "保留原视频声音", type: "boolean", defaultValue: false },
      {
        key: "sync", label: "时长对齐", type: "select", defaultValue: "none",
        options: [
          { value: "none", label: "不对齐（取较长者）" },
          { value: "video_trim", label: "以视频为准 · 裁剪音频" },
          { value: "video_speed", label: "以视频为准 · 音频变速" },
          { value: "audio_trim", label: "以音频为准 · 裁剪视频" },
          { value: "audio_speed", label: "以音频为准 · 视频变速" },
        ],
      },
    ],
  },
  {
    key: "compile_image_audio",
    label: "图片+音频成片",
    description: "将多张图片与一段音频合成为视频（自动转场），视频长度取决于音频",
    outputKind: "video",
    fields: [
      { key: "images", label: "图片（按出场顺序）", type: "images", required: true },
      { key: "audio", label: "音频", type: "audio", required: true },
    ],
  },
  {
    key: "audio_extract",
    label: "提取音频",
    description: "抽取视频中的音轨并保存为音频文件",
    outputKind: "audio",
    fields: [
      { key: "video", label: "视频", type: "video", required: true },
      {
        key: "format", label: "输出格式", type: "select", defaultValue: "mp3",
        options: [
          { value: "mp3", label: "MP3" },
          { value: "m4a", label: "M4A" },
        ],
      },
    ],
  },
  {
    key: "video_speed",
    label: "视频变速",
    description: "调整视频 / 音频播放速度（0.1x ~ 4x）",
    outputKind: "video",
    fields: [
      { key: "video", label: "视频 / 音频", type: "media", required: true },
      { key: "speed", label: "倍速", type: "number", required: true, min: 0.1, max: 4, step: 0.1, defaultValue: 1 },
    ],
  },
  {
    key: "ajust_audio_volume",
    label: "音量调整",
    description: "调整视频 / 音频的音量（0 静音 ~ 4 倍）",
    outputKind: "video",
    fields: [
      { key: "video", label: "视频 / 音频", type: "media", required: true },
      { key: "volume", label: "音量倍数", type: "number", required: true, min: 0, max: 4, step: 0.1, defaultValue: 1 },
    ],
  },
  {
    key: "audio_denoise",
    label: "音频降噪",
    description: "去除视频 / 音频中的噪声，提升音质",
    outputKind: "video",
    fields: [
      { key: "video", label: "视频 / 音频", type: "media", required: true },
    ],
  },
  {
    key: "audio_mix",
    label: "音频混音",
    description: "叠加多个音频（输出时长以最长的为准）",
    outputKind: "audio",
    fields: [
      { key: "audios", label: "音频列表", type: "audios", required: true },
    ],
  },
  {
    key: "video_super_resolution",
    label: "视频超分",
    description: "低分辨率视频重建为高分辨率（视频需 ≤15 秒，原片 ≤1080P）",
    outputKind: "video",
    slow: true,
    fields: [
      { key: "video", label: "视频", type: "video", required: true },
      {
        key: "resolution", label: "目标分辨率", type: "select", required: true, defaultValue: "1080p",
        options: [
          { value: "720p", label: "720P" },
          { value: "1080p", label: "1080P" },
          { value: "2K", label: "2K" },
          { value: "4K", label: "4K" },
        ],
      },
    ],
  },
  {
    key: "insert_frame",
    label: "视频插帧",
    description: "帧率提升至 2 倍，画面动作更流畅（视频需 ≤15 秒）",
    outputKind: "video",
    slow: true,
    fields: [
      { key: "video", label: "视频", type: "video", required: true },
    ],
  },
];

export function editTool(key: string): EditToolDef {
  const t = EDIT_TOOLS.find((x) => x.key === key);
  if (!t) throw new Error(`未知剪辑工具: ${key}`);
  return t;
}

/** 素材字段类型 → 资产 kind 列表 */
export function assetKindsForField(type: EditFieldType): ("image" | "video" | "audio")[] {
  switch (type) {
    case "video":
    case "videos":
      return ["video"];
    case "audio":
    case "audios":
      return ["audio"];
    case "media":
      return ["video", "audio"];
    case "images":
      return ["image"];
    default:
      return [];
  }
}

export function isMultiField(type: EditFieldType): boolean {
  return type === "videos" || type === "images" || type === "audios";
}

export function isAssetField(type: EditFieldType): boolean {
  return assetKindsForField(type).length > 0;
}
