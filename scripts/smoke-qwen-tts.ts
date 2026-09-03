import "dotenv/config";
import { generateQwenVoiceClone } from "../src/lib/modelscope/qwen-tts";
import {
  isQwenTtsInstanceKey,
  qwenTtsDefaultInstance,
  qwenTtsInstanceConfig,
} from "../src/lib/modelscope/qwen-tts-runtime";

const referenceUrl =
  process.env.QWEN_TTS_REFERENCE_URL ||
  "https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-TTS-Repo/clone.wav";
const referenceText =
  process.env.QWEN_TTS_REFERENCE_TEXT ||
  "Okay. Yeah. I resent you. I love you. I respect you. But you know what? You blew it! And thanks to you.";

async function main() {
  const modelSize =
    process.env.QWEN_TTS_MODEL_SIZE === "1.7B" ? "1.7B" : "0.6B";
  const requestedInstance = process.env.QWEN_TTS_INSTANCE;
  const instance = isQwenTtsInstanceKey(requestedInstance)
    ? requestedInstance
    : qwenTtsDefaultInstance();
  const instanceConfig = qwenTtsInstanceConfig(instance);
  if (!instanceConfig.configured || !instanceConfig.url) {
    throw new Error(`${instanceConfig.label}尚未配置`);
  }
  const spaceUrl = instanceConfig.url;
  const token = instanceConfig.accessToken;
  const configResponse = await fetch(`${spaceUrl}/config`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const config = (await configResponse.json()) as Record<string, unknown>;
  console.log(
    `[qwen-tts-smoke] config_status=${configResponse.status} root=${String(config.root ?? "")} api_prefix=${String(config.api_prefix ?? "")}`
  );
  const preflight = await fetch(`${spaceUrl}/gradio_api/info`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  console.log(
    `[qwen-tts-smoke] api_info_status=${preflight.status} content_type=${preflight.headers.get("content-type")}`
  );
  if (!preflight.ok) {
    throw new Error(`创空间 API 元数据读取失败：HTTP ${preflight.status}`);
  }

  const response = await fetch(referenceUrl);
  if (!response.ok) {
    throw new Error(`参考音频下载失败：HTTP ${response.status}`);
  }
  const referenceAudio = Buffer.from(await response.arrayBuffer());
  console.log(`[qwen-tts-smoke] reference_bytes=${referenceAudio.length}`);
  console.log(`[qwen-tts-smoke] model_size=${modelSize}`);
  console.log(`[qwen-tts-smoke] instance=${instance}`);

  const result = await generateQwenVoiceClone({
    referenceAudio,
    referenceText,
    targetText: "The Haitun voice cloning integration test completed successfully.",
    language: "English",
    useXVectorOnly: false,
    modelSize,
    instance,
  });
  console.log(`[qwen-tts-smoke] status=${result.status}`);
  console.log(`[qwen-tts-smoke] output_bytes=${result.audio.length}`);
  console.log(`[qwen-tts-smoke] audio_url=${result.audioUrl}`);
}

main().catch((error) => {
  console.error("[qwen-tts-smoke] failed", error);
  process.exitCode = 1;
});
