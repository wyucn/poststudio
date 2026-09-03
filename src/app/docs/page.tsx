import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";
import { DolphinMark } from "@/components/dolphin-mark";

export const metadata: Metadata = {
  title: "使用文档 | Haitun Post Studio",
  description: "海豚后期 AIGC 协同创作平台使用指南",
};

const SECTIONS = [
  { id: "intro", title: "平台简介" },
  { id: "account", title: "登录与账号" },
  { id: "project", title: "项目与协作" },
  { id: "create-image", title: "创作 · 图像" },
  { id: "create-video", title: "创作 · 视频" },
  { id: "create-audio", title: "创作 · 音乐与配音" },
  { id: "history", title: "我的生成记录" },
  { id: "assets", title: "素材库" },
  { id: "tasks", title: "任务中心" },
  { id: "scope", title: "当前功能范围" },
  { id: "faq", title: "常见问题" },
];

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
        <span className="font-mono text-sm text-primary/60">#</span>
        {title}
      </h2>
      <div className="space-y-3 text-ui leading-relaxed text-foreground/90">
        {children}
      </div>
    </section>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-info/25 bg-info-muted px-3 py-2 text-sm text-info">
      <span className="mr-1.5 font-mono text-micro uppercase tracking-widest">
        tip
      </span>
      {children}
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-warning/25 bg-warning-muted px-3 py-2 text-sm text-warning">
      <span className="mr-1.5 font-mono text-micro uppercase tracking-widest">
        note
      </span>
      {children}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
      {children}
    </code>
  );
}

function DocTable({
  head,
  rows,
}: {
  head: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/60">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocsPage() {
  return (
    <>
      <header className="scroll-edge-fade sticky top-0 z-40 bg-background/80 backdrop-blur-md backdrop-saturate-150">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/projects" className="group flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
              <DolphinMark className="size-5" />
            </span>
            <span className="leading-tight">
              <span className="block font-mono text-sm font-semibold tracking-[0.08em]">
                HAITUN<span className="text-primary">.</span>POST
              </span>
              <span className="block font-mono text-micro uppercase tracking-[0.18em] text-muted-foreground">
                使用文档 / User Guide
              </span>
            </span>
          </Link>
          <Link
            href="/projects"
            className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> 返回项目
          </Link>
        </div>
      </header>

      <main className="rise-in mx-auto flex w-full max-w-6xl gap-10 px-4 py-10">
        {/* 侧边目录 */}
        <nav className="sticky top-24 hidden h-fit w-52 shrink-0 lg:block">
          <p className="mb-3 flex items-center gap-1.5 font-mono text-micro uppercase tracking-[0.2em] text-muted-foreground">
            <BookOpen className="size-3.5" /> contents
          </p>
          <ul className="space-y-1 border-l border-border text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block border-l-2 border-transparent py-1 pl-3 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* 正文 */}
        <article className="min-w-0 flex-1 space-y-12 pb-24">
          <div>
            <p className="font-mono text-micro uppercase tracking-[0.2em] text-primary/70">
              {"// user guide"}
            </p>
            <h1 className="text-display text-3xl font-extrabold">
              Haitun Post Studio 使用文档
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              在项目中生成图像、视频、音乐与配音，并与团队共享和评审素材。
            </p>
          </div>

          <Section id="intro" title="平台简介">
            <p>
              Haitun Post Studio 集成图像、视频、音乐与语音生成，
              为创意与后期团队提供项目制素材创作和协作工作台。
            </p>
            <p>核心理念：</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>项目制协同</strong>——所有生成内容沉淀在项目素材库，成员共享；
              </li>
              <li>
                <strong>专注创作</strong>——「手动创作」提供图像、视频、音乐、配音四类生成，逐步打磨到满意；
              </li>
              <li>
                <strong>异步任务</strong>——所有生成都是后台任务，提交后可随意切换页面，结果自动回填。
              </li>
            </ul>
          </Section>

          <Section id="account" title="登录与账号">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                使用<strong>公司账号（LDAP）一键登录</strong>，无需注册；首次访问会自动跳转统一登录页。
              </li>
              <li>
                <strong>修改昵称</strong>：点击页面右上角自己的名字即可修改展示昵称（最长
                24 字）。昵称只影响显示，登录与成员添加仍以 LDAP 识别。
              </li>
              <li>
                <strong>管理员</strong>：拥有 <Kbd>admin</Kbd>{" "}
                标识的用户可查看平台上所有项目（非自己参与的项目会带{" "}
                <Kbd>admin view</Kbd> 角标），并可删除任意素材。
              </li>
            </ul>
          </Section>

          <Section id="project" title="项目与协作">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                在项目列表点击<strong>「新建项目」</strong>，填写名称与描述，并选择
                <strong>可见性</strong>即可创建；创建者自动成为项目所有者。
              </li>
              <li>
                <strong>成员管理</strong>：项目所有者在任务或资产页右上角点击「成员管理」，输入同事的{" "}
                <strong>LDAP 账号</strong>（如 <Kbd>zhangsan</Kbd>
                ）并选择查看者或编辑者；对方无需先登录过本站。
              </li>
              <li>
                <strong>在线状态</strong>：成员名旁的绿点表示当前在线（2
                分钟内有操作），灰点表示离线；顶部还有在线人数统计。
              </li>
              <li>项目成员共享素材库与任务列表，但可执行操作由角色决定。</li>
            </ul>
            <p className="font-semibold">项目角色：Owner / Editor / Viewer</p>
            <DocTable
              head={["角色", "项目权限", "任务权限"]}
              rows={[
                ["所有者 Owner", "管理成员、角色、可见性与项目生命周期；可创作编辑", "可取消、重试或删除项目内全部任务"],
                ["编辑者 Editor", "可生成、上传、评审、评论和编辑项目内容", "只能取消、重试或删除自己创建的任务"],
                ["查看者 Viewer", "只读查看素材、任务和评论", "不能生成或修改任务"],
              ]}
            />
            <p className="font-semibold">项目可见性：私有 / 全公司公开</p>
            <DocTable
              head={["可见性", "谁能看到", "非成员权限"]}
              rows={[
                ["私有（默认）", "仅项目成员与管理员", "无法访问"],
                ["全公司公开", "所有登录同事都能在项目列表看到", "只读浏览，不能创作 / 编辑"],
              ]}
            />
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>新建时选择</strong>：弹窗里点「私有」或「全公司公开」卡片即可；
              </li>
              <li>
                <strong>随时切换</strong>：在项目列表卡片<strong>右上角</strong>点
                <Kbd>🔒 私有</Kbd> / <Kbd>🌐 公开</Kbd>{" "}
                徽章一键切换（仅<strong>项目所有者或管理员</strong>可切换，其他人看到的是只读标识）；
              </li>
              <li>
                <strong>只读浏览</strong>：非成员打开公开项目时，顶部会显示「只读浏览」提示，
                可以查看素材与任务，但创作 / 上传 / 删除 / 评审等操作按钮均不可用；
                如需参与，请让项目所有者把你加入并分配角色。
              </li>
            </ul>
            <Warn>
              「全公司公开」目前是面向<strong>所有登录同事</strong>
              的；按部门分组的公开范围在规划中，待接入组织架构数据后开放。
            </Warn>
          </Section>

          <Section id="create-image" title="创作 · 图像">
            <p>
              「手动创作 → 图像」支持文生图与参考图生图。选择模型后，面板会
              <strong>自动过滤该模型支持的尺寸</strong>，并标注像素分辨率与画幅比例。
            </p>
            <DocTable
              head={["模型", "定位"]}
              rows={[
                ["Seedream 5.0 Pro", "高质量单图；1K/2K，最多 10 张参考图"],
                ["Seedream 5.0 Lite（默认）", "当前实际接入的 Lite 版本，正式出图首选"],
                ["Seedream 4.5", "质量与速度平衡"],
                ["Seedream 4.0", "上一代，速度快"],
              ]}
            />
            <Tip>
              在提示词框输入 <Kbd>@</Kbd>{" "}
              可直接引用素材库中的图片作为参考图，无需手动挑选。
            </Tip>
            <p className="font-semibold">创作类型预设：角色 / 场景 / 风格设定</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>角色设定</strong>
                ：填写角色名与外形描述（也可上传照片 / 已有形象作参考），自动套用专业模板生成
                <strong>角色三视图设定表</strong>（正/侧/背 + 面部与服饰细节）；
              </li>
              <li>
                <strong>场景设定</strong>
                ：填写场景名与空间、光线、氛围描述，生成无人物的
                <strong>场景概念设定图</strong>；
              </li>
              <li>
                <strong>风格设定</strong>
                ：填写风格名与色调、笔触、光线描述（或上传参考图提炼），生成
                <strong>风格基调示意图</strong>，用于统一全片视觉；
              </li>
              <li>
                生成的设定图会带「角色 / 场景 / 风格」标签存入素材库，
                <strong>后续可作为参考图直接引用</strong>
                ，保证多张图之间形象、环境与画风一致。
              </li>
            </ul>
          </Section>

          <Section id="create-video" title="创作 · 视频">
            <p>「手动创作 → 视频」提供五种生成模式（不同模型支持的模式不同）：</p>
            <DocTable
              head={["模式", "说明"]}
              rows={[
                ["文生视频", "纯提示词驱动，描述画面、运动与运镜"],
                ["首帧参考", "上传一张图片作为视频起始画面"],
                ["首尾帧", "同时指定起始与结束画面，模型补全中间过程"],
                [
                  "全能参考",
                  "混合上传图片 / 视频 / 音频作参考，提示词中可描述如何使用素材中的人物、场景或音乐",
                ],
                [
                  "视频延长",
                  "选择一段视频向后续写或向前补拍；生成的新片段独立入库，不覆盖原视频",
                ],
              ]}
            />
            <DocTable
              head={["模型", "定位"]}
              rows={[
                [
                  "Seedance 2.0（默认）",
                  "正式出片首选，支持全能参考、原生延长与 4K 10-bit 输出",
                ],
                ["Seedance 2.0 Fast", "草稿预览，支持全能参考与原生延长"],
                ["Seedance 1.5 Pro", "上一代备用，文生视频可固定摄像头"],
                ["Seedance 1.0 Pro / Fast", "支持按帧数精确控制片长，适合小数秒镜头"],
              ]}
            />
            <p className="font-semibold">全能参考素材规则（与官方一致）：</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>图片 ≤ 30MB；视频 MP4 / MOV，≤ 50MB；音频 MP3 / WAV，≤ 15MB；</li>
              <li>视频、音频单段时长 2–15 秒，同类素材总时长合计不超过 15 秒；</li>
              <li>音频不能单独作参考，需至少搭配一张图片或一段视频；</li>
              <li>
                素材卡会显示模型识别名（图片1 / 视频1 / 音频1），使用 @ 引用素材时会自动转换为对应识别名；
              </li>
              <li>
                超过 15 秒的素材会自动弹出<strong>裁剪工具</strong>
                ：视频按起止时间云端裁剪，音频在波形图上拖动入/出点截选。
              </li>
            </ul>
            <Tip>
              选择「智能时长」可让模型根据内容自动决定片长；提示词框同样支持{" "}
              <Kbd>@</Kbd> 引用素材库素材。Seedance 2.0 系列成功生成后，还会把方舟返回的无水印尾帧自动保存为图片素材。
            </Tip>
            <Tip>
              Seedance 1.0 Pro / Fast 还支持「按帧数」模式：固定 24 fps，帧数范围 29–289、每次递增 4；
              「按时长」与「按帧数」互斥，生成小数秒镜头时以实际返回的帧数和时长为准。
            </Tip>
          </Section>

          <Section id="create-audio" title="创作 · 音乐与配音">
            <p>
              <strong>音乐</strong>：支持灵感生成歌曲、输入歌词生成歌曲和纯音乐 BGM，
              可按模式选择时长、风格与情绪等参数。
            </p>
            <p>
              <strong>语音合成（配音）</strong>：输入旁白文本，选择预置音色、语速和模型支持的情绪。
              Qwen3-TTS 还可以使用本人或已获得明确授权的参考音频进行声音克隆；公共创空间属于实验性共享服务，
              设置中会显示健康状态、本站排队量，并在管理员配置后允许切换自建实例。
            </p>
            <Tip>
              最近一次成功配音会直接显示在主创作器的紧凑播放器中，可立即试听、下载或复用参数；
              历史记录中的播放器还带<strong>波形图</strong>，可拖动入/出点截选片段，
              下载 WAV 或直接存回素材库。
            </Tip>
          </Section>

          <Section id="history" title="我的生成记录">
            <p>
              每个创作面板右侧 / 下方都有「我的生成记录」，只显示
              <strong>你自己</strong>在该面板提交的任务，切换页面后回来依然保留：
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>复用配置</strong>——一键把历史任务的提示词、模型、参数回填到表单；
              </li>
              <li>
                <strong>再次生成</strong>——按原参数直接重新提交一次；
              </li>
              <li>排队中 / 生成中的任务会自动轮询刷新，完成后直接预览产物。</li>
            </ul>
            <Warn>素材库是全项目共享的；生成记录是个人视角，二者不冲突。</Warn>
          </Section>

          <Section id="assets" title="素材库">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                按<strong>图像 / 视频 / 音频</strong>
                分类浏览，全项目成员共享；
              </li>
              <li>
                <strong>检索</strong>
                ：支持按提示词 / 文件名 / 设定名模糊搜索，并可按创建人、角色 / 场景 /
                风格设定筛选；
              </li>
              <li>
                <strong>评审</strong>
                ：详情弹窗内可把素材标记为「采用」或「废弃」（卡片上显示角标），并支持成员间
                <strong>评论</strong>讨论；
              </li>
              <li>
                <strong>上传</strong>：把本地文件直接<strong>拖拽</strong>
                到上传区即可，支持多文件与进度显示；
              </li>
              <li>
                点击素材卡片查看<strong>详情</strong>
                ：预览、生成参数（模型 / 提示词 / 规格）、来源与下载；
              </li>
              <li>
                音频详情带波形图，可截选片段下载或另存为新素材；
              </li>
              <li>
                <strong>视频截图</strong>
                ：视频播放器（素材详情、镜头卡片、生成记录）悬停出现「截图」按钮，截取当前帧后可下载或
                <strong>存入素材库</strong>（之后可用作首帧、参考图或角色视图）；
              </li>
              <li>
                <strong>删除</strong>
                ：详情弹窗内点「删除」并确认。素材创建者、项目创建者与管理员可删，删除不可恢复。
              </li>
            </ul>
          </Section>

          <Section id="tasks" title="任务中心">
            <p>
              「任务」标签页汇总项目内所有成员的生成任务，可查看状态（排队 / 进行中 /
              成功 / 失败）、参数与错误信息；失败的任务支持一键重试。
            </p>
            <p>
              服务更新重启时，进行中的任务会被自动标记为失败（原因注明「服务重启导致任务中断」），重试即可；已提交到方舟的视频任务不受影响，会自动续轮。
            </p>
            <Tip>
              管理员在顶栏可进入<strong>「控制台」</strong>
              面板，按项目 / 成员查看近 7 天、近 30 天或全部生成任务；控制台的
              <strong>「模型配置」</strong>可管理模型能力、Endpoint、上下线和健康状态，
              密钥仍只保存在服务器环境变量中；运维健康区域会显示备份、中转清理和数据库一致性巡检结果。配置了企业微信群机器人后，视频生成完成、被加入项目等事件还会推送
              <strong>企微通知</strong>。
            </Tip>
          </Section>

          <Section id="scope" title="当前功能范围">
            <p>以下模块曾出现在旧版本和历史截图中，但当前版本已经移除：</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>自动分镜流水线、批量镜头生成和一键成片；</li>
              <li>独立角色库；</li>
              <li>文案 / 文本生成标签页；</li>
              <li>独立剪辑工具页和时间线编辑器。</li>
            </ul>
            <Warn>
              图像里的角色 / 场景 / 风格设定仍然可用；参考视频的裁剪也仍然可用，
              但它们分别属于图像创作预设与视频生成前置处理。
            </Warn>
          </Section>

          <Section id="faq" title="常见问题">
            <div className="space-y-4">
              <div>
                <p className="font-semibold">Q：点了生成没反应？</p>
                <p>
                  所有生成均为后台任务，提交后会出现在「我的生成记录」并自动轮询；视频通常需要
                  1–5 分钟，请耐心等待，期间可以切换页面或继续提交其他任务。
                </p>
              </div>
              <div>
                <p className="font-semibold">Q：参考素材上传被拒绝？</p>
                <p>
                  请检查格式与大小（视频 MP4/MOV ≤50MB、音频 MP3/WAV
                  ≤15MB）、时长（单段 2–15 秒、同类合计 ≤15
                  秒）。超长素材会自动弹出裁剪对话框，裁剪后即可使用；若文件元数据无法读取也会被拒，请转码后重试。
                </p>
              </div>
              <div>
                <p className="font-semibold">Q：为什么我删不掉某个素材？</p>
                <p>
                  只有素材创建者本人、项目创建者或平台管理员可以删除素材，避免误删他人成果。
                </p>
              </div>
              <div>
                <p className="font-semibold">Q：怎么把项目共享给全公司 / 改回私有？</p>
                <p>
                  在项目列表卡片右上角点可见性徽章即可一键切换（仅创建者或管理员可操作）。设为「全公司公开」后，
                  所有同事都能在列表看到并只读浏览；需要他们参与编辑时再「添加成员」即可。
                </p>
              </div>
              <div>
                <p className="font-semibold">Q：添加成员时填什么？</p>
                <p>
                  填同事的 LDAP 账号（邮箱前缀，如 <Kbd>zhangsan</Kbd>
                  ），不需要对方先登录过本站；对方首次登录后自动关联。
                </p>
              </div>
              <div>
                <p className="font-semibold">Q：改了昵称会影响登录吗？</p>
                <p>
                  不会。昵称只用于界面展示，登录、权限与成员识别始终基于公司 LDAP 账号。
                </p>
              </div>
            </div>
          </Section>

          <footer className="border-t border-border pt-6 font-mono text-xs text-muted-foreground">
            HAITUN.POST · 海豚后期 AIGC Studio · 有问题或建议请联系平台管理员
          </footer>
        </article>
      </main>
    </>
  );
}
