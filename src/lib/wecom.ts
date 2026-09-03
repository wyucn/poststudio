/**
 * 企业微信通知，支持两种后端（配了哪个走哪个，都配则都发）：
 * 1. 群机器人 Webhook（WECOM_WEBHOOK_URL）——最简单，推到固定群；
 * 2. 智能机器人长连接（WECOM_BOT_ID + WECOM_BOT_SECRET，见 wecom-bot.ts）——
 *    成员单聊绑定后可直达个人，群里 @机器人 可登记通知群。
 * 都未配置时静默跳过，不影响主流程。
 */
import { pushViaBot } from "@/lib/wecom-bot";
import { errorDiagnostic } from "@/lib/error-safety";

export async function notifyWecom(
  content: string,
  mentionLdaps: string[] = []
): Promise<void> {
  try {
    pushViaBot(content, mentionLdaps);
  } catch (e) {
    console.error("[wecom] 机器人推送失败:", errorDiagnostic(e));
  }

  const url = process.env.WECOM_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "text",
        text: { content, mentioned_list: mentionLdaps },
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("[wecom] Webhook 通知发送失败:", errorDiagnostic(e));
  }
}

/** 从邮箱提取账号前缀（user@example.com → user） */
export function ldapOf(email: string): string {
  return email.split("@")[0];
}
