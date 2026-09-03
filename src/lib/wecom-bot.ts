/**
 * 企业微信「智能机器人」长连接客户端（API 模式）。
 * 协议：wss://openws.work.weixin.qq.com，aibot_subscribe 认证，30s 心跳，
 * aibot_send_msg 主动推送（仅限「用户先给机器人发过消息」的会话）。
 * 文档：https://developer.work.weixin.qq.com/document/path/101463
 *
 * 绑定流程（解决加密 userid 与平台 ldap 的映射问题）：
 * - 成员单聊给机器人发送自己的 ldap → 记录 ldap → userid 映射，之后通知可推到单聊；
 * - 群里 @机器人发任意消息 → 把该群登记为通知广播群。
 * 映射持久化在 DATA_DIR/wecom-bot-registry.json。
 */
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { eq } from "drizzle-orm";
import { db, users, DATA_DIR } from "@/db";
import { errorDiagnostic, redactSensitiveText } from "@/lib/error-safety";
import { organizationEmailDomain } from "@/lib/auth/policy";
import { publicAppUrl } from "@/lib/app-url";

const WS_URL = "wss://openws.work.weixin.qq.com";
const HEARTBEAT_MS = 30_000;
const LDAP_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

interface Registry {
  /** ldap → 企微 userid（可能是加密 id，原样使用） */
  users: Record<string, string>;
  /** 群 chatid → 登记时间 */
  groups: Record<string, number>;
}

function registryPath() {
  return path.join(DATA_DIR, "wecom-bot-registry.json");
}

function loadRegistry(): Registry {
  try {
    return JSON.parse(fs.readFileSync(registryPath(), "utf8")) as Registry;
  } catch {
    return { users: {}, groups: {} };
  }
}

function saveRegistry(r: Registry) {
  fs.writeFileSync(registryPath(), JSON.stringify(r, null, 2));
}

class WecomBotClient {
  private ws: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private retryMs = 1000;
  private subscribed = false;
  private stopped = false;

  constructor(
    private botId: string,
    private secret: string
  ) {}

  start() {
    this.connect();
  }

  private connect() {
    if (this.stopped) return;
    const ws = new WebSocket(WS_URL);
    this.ws = ws;
    this.subscribed = false;

    ws.on("open", () => {
      this.send({
        cmd: "aibot_subscribe",
        headers: { req_id: randomUUID() },
        body: { bot_id: this.botId, secret: this.secret },
      });
    });

    ws.on("message", (raw) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.onFrame(frame);
    });

    const reconnect = () => {
      this.cleanup();
      if (this.stopped) return;
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 30_000);
    };
    ws.on("close", reconnect);
    ws.on("error", (e) => {
      console.error("[wecom-bot] 连接错误:", errorDiagnostic(e));
      ws.close();
    });
  }

  private cleanup() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.ws = null;
    this.subscribed = false;
  }

  private send(frame: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private onFrame(frame: Record<string, unknown>) {
    const cmd = String(frame.cmd ?? "");

    // 订阅响应（无 cmd，带 errcode）
    if (!cmd && typeof frame.errcode === "number") {
      if (frame.errcode === 0 && !this.subscribed) {
        this.subscribed = true;
        this.retryMs = 1000;
        console.log("[wecom-bot] 长连接已订阅");
        this.heartbeat = setInterval(() => {
          this.send({ cmd: "ping", headers: { req_id: randomUUID() } });
        }, HEARTBEAT_MS);
      } else if (frame.errcode !== 0) {
        console.error(
          "[wecom-bot] 指令失败:",
          frame.errcode,
          redactSensitiveText(String(frame.errmsg ?? ""))
        );
      }
      return;
    }

    if (cmd === "aibot_msg_callback") {
      this.onMessage(
        frame.headers as { req_id?: string },
        frame.body as {
          chatid?: string;
          chattype?: string;
          from?: { userid?: string };
          msgtype?: string;
          text?: { content?: string };
        }
      );
    }
    // aibot_event_callback（进入会话等）无需处理
  }

  /** 用户消息：单聊发 ldap 即绑定；群聊 @机器人 即登记通知群 */
  private onMessage(
    headers: { req_id?: string } | undefined,
    body:
      | {
          chatid?: string;
          chattype?: string;
          from?: { userid?: string };
          msgtype?: string;
          text?: { content?: string };
        }
      | undefined
  ) {
    if (!body) return;
    const reqId = headers?.req_id ?? randomUUID();
    const reply = (content: string) => {
      this.send({
        cmd: "aibot_respond_msg",
        headers: { req_id: reqId },
        body: { msgtype: "markdown", markdown: { content } },
      });
    };

    // 群消息文本带 @机器人 前缀，先剥掉再识别指令
    const rawText = (body.text?.content ?? "").replace(/@\S+/g, "").trim();
    const isUnbind = /解绑|取消通知|退订/.test(rawText);

    if (body.chattype === "group" && body.chatid) {
      const r = loadRegistry();
      if (isUnbind) {
        delete r.groups[body.chatid];
        saveRegistry(r);
        reply("本群已**取消**海豚后期通知登记，不会再收到推送。想恢复时 @我说句话即可～");
        return;
      }
      if (!r.groups[body.chatid]) {
        r.groups[body.chatid] = Date.now();
        saveRegistry(r);
      }
      reply(
        "本群已登记为 **海豚后期通知群**，生成完成 / 成片合成 / 项目动态会推送到这里～\n@我说「解绑」可随时取消。"
      );
      return;
    }

    // 单聊：期待用户发送自己的 ldap 完成绑定
    const userid = body.from?.userid;
    if (!userid) return;

    if (isUnbind) {
      const r = loadRegistry();
      const bound = Object.entries(r.users).filter(([, uid]) => uid === userid);
      if (bound.length) {
        for (const [ldap] of bound) delete r.users[ldap];
        saveRegistry(r);
        reply(
          `已解绑 ${bound.map(([l]) => `\`${l}\``).join("、")}，不会再给你发通知了。想恢复时再发一次 LDAP 即可～`
        );
      } else {
        reply("你当前没有绑定任何账号哦。发送你的 **LDAP** 即可绑定通知。");
      }
      return;
    }

    const text = rawText.toLowerCase();
    if (LDAP_RE.test(text)) {
      const account = db
        .select()
        .from(users)
        .where(eq(users.email, `${text}@${organizationEmailDomain()}`))
        .get();
      if (account) {
        const r = loadRegistry();
        r.users[text] = userid;
        saveRegistry(r);
        reply(
          `绑定成功！**${account.name}**（${text}），之后海豚后期的任务完成提醒会发到这里。`
        );
        return;
      }
      reply(
        `没有找到账号 \`${text}\`，请先登录过 [Post Studio](${publicAppUrl()}) 再来绑定～`
      );
      return;
    }
    reply(
      "你好呀！回复你的 **LDAP 账号**（邮箱前缀，如 `zhangsan`）即可绑定海豚后期通知；发送「解绑」可取消。"
    );
  }

  /** 主动推送 markdown；returns 是否已发出（不保证送达） */
  push(chatid: string, chatType: 1 | 2, content: string): boolean {
    if (!this.subscribed) return false;
    this.send({
      cmd: "aibot_send_msg",
      headers: { req_id: randomUUID() },
      body: { chatid, chat_type: chatType, msgtype: "markdown", markdown: { content } },
    });
    return true;
  }
}

function getClient(): WecomBotClient | null {
  const g = globalThis as unknown as { __haitunWecomBot?: WecomBotClient | null };
  if (g.__haitunWecomBot !== undefined) return g.__haitunWecomBot;
  const botId = process.env.WECOM_BOT_ID;
  const secret = process.env.WECOM_BOT_SECRET;
  if (!botId || !secret) {
    g.__haitunWecomBot = null;
    return null;
  }
  const client = new WecomBotClient(botId, secret);
  client.start();
  g.__haitunWecomBot = client;
  console.log("[haitun-post-studio] 企微智能机器人长连接客户端已启动");
  return client;
}

/** 在服务启动时调用，建立长连接（未配置则跳过） */
export function startWecomBot() {
  getClient();
}

/**
 * 通过智能机器人推送通知：
 * - 已绑定的 mentionLdaps 成员 → 单聊直达
 * - 已登记的通知群 → 群播
 */
export function pushViaBot(content: string, mentionLdaps: string[]): boolean {
  const client = getClient();
  if (!client) return false;
  const r = loadRegistry();
  let sent = false;
  for (const ldap of mentionLdaps) {
    const userid = r.users[ldap];
    if (userid) sent = client.push(userid, 1, content) || sent;
  }
  for (const chatid of Object.keys(r.groups)) {
    sent = client.push(chatid, 2, content) || sent;
  }
  return sent;
}
