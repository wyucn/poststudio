/**
 * Coze 插件链路 smoke test
 * 用法：npx tsx scripts/coze-smoke.ts          （只测 TTS，最快最便宜）
 *      npx tsx scripts/coze-smoke.ts --edit    （加测剪辑：对 TTS 产物变速）
 *      npx tsx scripts/coze-smoke.ts --music   （加测音乐 BGM，约 1-3 分钟）
 *      npx tsx scripts/coze-smoke.ts --all
 */
import { config } from "dotenv";
config({ path: ".env" });

import { callCozeTool, cozeData } from "../src/lib/coze/client";

const args = process.argv.slice(2);
const testEdit = args.includes("--edit") || args.includes("--all");
const testMusic = args.includes("--music") || args.includes("--all");

async function main() {
  console.log("=== Coze 插件 Smoke Test ===\n");

  // 1. 语音合成
  console.log("[1/3] 语音合成（speech_synthesis）...");
  let t = Date.now();
  const tts = await callCozeTool("tts", "speech_synthesis", {
    text: "海豚后期工作站冒烟测试：语音合成链路正常。",
    speed_ratio: 1,
  });
  const ttsData = cozeData(tts);
  const ttsUrl = String(ttsData.link ?? "");
  if (!ttsUrl) throw new Error("TTS 未返回链接");
  console.log(
    `  ✓ ${((Date.now() - t) / 1000).toFixed(1)}s · 时长 ${ttsData.duration}s\n    ${ttsUrl.slice(0, 100)}...\n`
  );

  // 2. 剪辑：对刚才的 TTS 音频做 1.5 倍速（验证剪辑插件 + 外部 URL 拉取）
  if (testEdit) {
    console.log("[2/3] 剪辑工具（video_speed 1.5x on TTS 音频）...");
    t = Date.now();
    const sp = await callCozeTool("videoEdit", "video_speed", {
      video: ttsUrl,
      speed: 1.5,
      url_expire: 86400,
    });
    const spData = cozeData(sp);
    if (!spData.url) throw new Error(`剪辑未返回产物: ${sp.rawText.slice(0, 200)}`);
    const meta = spData.video_meta as { type?: string; duration?: number } | undefined;
    console.log(
      `  ✓ ${((Date.now() - t) / 1000).toFixed(1)}s · ${meta?.type} ${meta?.duration}s\n    ${String(spData.url).slice(0, 100)}...\n`
    );
  } else {
    console.log("[2/3] 跳过剪辑（--edit 启用）\n");
  }

  // 3. 音乐：30 秒 BGM
  if (testMusic) {
    console.log("[3/3] 音乐生成（gen_bgm 30s，约 1-3 分钟）...");
    t = Date.now();
    const bgm = await callCozeTool("music", "gen_bgm", {
      Text: "海洋与月光主题的轻快电子背景音乐",
      Duration: 30,
      Genre: ["electronic"],
      Mood: ["dreamy"],
    });
    const bgmData = cozeData(bgm);
    const detail = (bgmData.SongDetail ?? {}) as { AudioUrl?: string; Duration?: number };
    if (!detail.AudioUrl) throw new Error(`音乐未返回产物: ${bgm.rawText.slice(0, 300)}`);
    console.log(
      `  ✓ ${((Date.now() - t) / 1000).toFixed(1)}s · 时长 ${detail.Duration}s\n    ${detail.AudioUrl.slice(0, 100)}...\n`
    );
  } else {
    console.log("[3/3] 跳过音乐（--music 启用）\n");
  }

  console.log("=== 全部通过 ===");
}

main().catch((e) => {
  console.error("✗ 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});
