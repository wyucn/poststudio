/**
 * 方舟三类接口 smoke test
 * 用法：npm run smoke            （只测文本，最快最便宜）
 *      npm run smoke -- --image  （加测图像）
 *      npm run smoke -- --pro    （测试 Seedream 5.0 Pro）
 *      npm run smoke -- --video  （加测视频，提交任务并轮询到完成）
 *      npm run smoke -- --all
 */
import { config } from "dotenv";
config({ path: ".env" });

import {
  generateImage,
  submitVideoTask,
  getVideoTask,
} from "../src/lib/ark/client";
import { defaultModel, getModel } from "../src/lib/ark/models";
import { imageCap, imagePx } from "../src/lib/ark/capabilities";

const args = process.argv.slice(2);
const testPro = args.includes("--pro");
const testImage = args.includes("--image") || args.includes("--all") || testPro;
const testVideo = args.includes("--video") || args.includes("--all");

async function main() {
  console.log("=== Haitun Post Studio Smoke Test ===\n");

  // 1. 图像（按模型能力表传具体像素值）
  if (testImage) {
    const imageModel = testPro ? getModel("seedream-5.0-pro") : defaultModel("image");
    const imageSize = imagePx("2K", "16:9", imageModel.key);
    console.log(`[1/2] 图像生成（${imageModel.label} / ${imageSize} / 16:9）...`);
    const t1 = Date.now();
    const images = await generateImage({
      endpointId: imageModel.endpointId,
      apiKeyEnv: imageModel.apiKeyEnv,
      prompt: "一只在月光下跃出海面的海豚，极简插画风格",
      size: imageSize,
      stream: imageCap(imageModel.key).supportsStream,
    });
    console.log(
      `  ✓ ${((Date.now() - t1) / 1000).toFixed(1)}s -> 实际尺寸 ${images[0].size ?? "?"} -> ${images[0].url.slice(0, 60)}...\n`
    );
  } else {
    console.log("[1/2] 图像生成 跳过（加 --image 开启）\n");
  }

  // 2. 视频
  if (testVideo) {
    console.log("[2/2] 视频生成（seedance-2.0-fast, 480p 5s 无声）...");
    const t2 = Date.now();
    const taskId = await submitVideoTask({
      endpointId: getModel("seedance-2.0-fast").endpointId,
      prompt: "一只海豚跃出月光下的海面，镜头缓慢上摇",
      resolution: "480p",
      duration: 5,
      ratio: "16:9",
      generateAudio: false,
    });
    console.log(`  任务已提交：${taskId}，轮询中...`);
    for (;;) {
      await new Promise((r) => setTimeout(r, 8000));
      const task = await getVideoTask(taskId);
      console.log(`  状态：${task.status}（${((Date.now() - t2) / 1000).toFixed(0)}s）`);
      if (task.status === "succeeded") {
        console.log(`  ✓ 视频地址：${task.videoUrl?.slice(0, 100)}...\n`);
        break;
      }
      if (task.status === "failed" || task.status === "cancelled") {
        throw new Error(`视频任务失败：${task.error}`);
      }
    }
  } else {
    console.log("[3/3] 视频生成 跳过（加 --video 开启）\n");
  }

  console.log("=== 全部通过 ===");
}

main().catch((e) => {
  console.error("\n✗ Smoke test 失败：", e instanceof Error ? e.message : e);
  process.exit(1);
});
