/**
 * 生成任务完成 / 失败的企业微信提醒（通用）。
 *
 * 提醒策略（由调用方决定何时调用）：
 * - 视频、音乐、配音：耗时较长、用户常已切走，成功 + 失败都提醒。
 * - 文字、图片：秒级完成、用户多在页面盯着，仅失败时提醒（避免刷屏）。
 * 未配置企微时 notifyWecom 静默跳过，不影响主流程。
 */
import { eq } from "drizzle-orm";
import { db, projects, users, type Task } from "@/db";
import { ldapOf, notifyWecom } from "@/lib/wecom";

const KIND_LABEL: Record<string, string> = {
  text: "文案",
  image: "图像",
  video: "视频",
  audio: "配音",
  music: "音乐",
  edit: "剪辑",
};
const KIND_EMOJI: Record<string, string> = {
  text: "📝",
  image: "🖼️",
  video: "🎬",
  audio: "🎙️",
  music: "🎵",
  edit: "✂️",
};

/** 推送任务终态提醒。ok=true 成功、false 失败；error 为失败原因。 */
export function notifyTaskDone(task: Task, ok: boolean, error?: string) {
  try {
    const owner = db.select().from(users).where(eq(users.id, task.userId)).get();
    if (!owner) return;
    const project = db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .get();
    const input = JSON.parse(task.inputJson) as { prompt?: string; text?: string };
    const brief = String(input.prompt ?? input.text ?? "").slice(0, 40);
    const label = KIND_LABEL[task.kind] ?? task.kind;
    const emoji = KIND_EMOJI[task.kind] ?? "✅";
    const ldap = ldapOf(owner.email);
    const proj = project?.name ?? "?";
    void notifyWecom(
      ok
        ? `${emoji} ${label}生成完成｜项目「${proj}」\n${brief}…\n@${ldap} 去素材库查看吧`
        : `⚠️ ${label}生成失败｜项目「${proj}」\n${brief}…\n原因：${error ?? "未知"}`,
      [ldap]
    );
  } catch {}
}
