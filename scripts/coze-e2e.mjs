/**
 * Web API 级端到端验证：登录 -> 建项目 -> TTS 配音 -> 音乐任务 -> 剪辑任务（音频变速）
 * 用法：node scripts/coze-e2e.mjs
 */
const BASE = "http://localhost:3000";
let cookie = "";

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.json ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...opts.headers,
    },
    body: opts.json ? JSON.stringify(opts.json) : opts.body,
    redirect: "manual",
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const kv = c.split(";")[0];
    if (kv.includes("authjs")) {
      const name = kv.split("=")[0];
      cookie = cookie
        .split("; ")
        .filter((x) => x && !x.startsWith(name + "="))
        .concat(kv)
        .join("; ");
    }
  }
  return res;
}

// 1. 登录（auth.js credentials）
const csrfRes = await req("/api/auth/csrf");
const { csrfToken } = await csrfRes.json();
const loginRes = await req("/api/auth/callback/credentials", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    csrfToken,
    email: "smoke@test.local",
    password: "smoke-test-123",
  }),
});
if (!cookie.includes("session-token")) {
  throw new Error(`登录失败: ${loginRes.status}`);
}
console.log("✓ 登录成功");

// 2. 建项目
const projRes = await req("/api/projects", {
  method: "POST",
  json: { name: "coze-smoke-" + Date.now().toString(36) },
});
const proj = await projRes.json();
if (!projRes.ok) throw new Error("建项目失败: " + JSON.stringify(proj));
console.log("✓ 项目创建:", proj.id);

// 3. TTS（同步）
let t = Date.now();
const ttsRes = await req(`/api/projects/${proj.id}/generate/tts`, {
  method: "POST",
  json: { text: "海豚后期端到端验证，配音链路正常。", voiceId: "7426720361753903141", speedRatio: 1 },
});
const tts = await ttsRes.json();
if (!ttsRes.ok) throw new Error("TTS 失败: " + JSON.stringify(tts));
console.log(
  `✓ TTS 完成 ${((Date.now() - t) / 1000).toFixed(1)}s · asset=${tts.asset.id} kind=${tts.asset.kind} bytes=${tts.asset.bytes}`
);

// 4. 音乐任务（BGM 30s，后台）
const musicRes = await req(`/api/projects/${proj.id}/generate/music`, {
  method: "POST",
  json: { mode: "bgm", text: "适合科技产品宣传的轻快背景音乐", duration: 30 },
});
const music = await musicRes.json();
if (!musicRes.ok) throw new Error("音乐提交失败: " + JSON.stringify(music));
console.log("✓ 音乐任务已提交:", music.task.id);

// 5. 剪辑任务：对 TTS 产物变速 1.5x（验证签名公开 URL 被 Coze 拉取）
const editRes = await req(`/api/projects/${proj.id}/edit`, {
  method: "POST",
  json: { tool: "video_speed", params: { video: tts.asset.id, speed: 1.5 } },
});
const edit = await editRes.json();
if (!editRes.ok) throw new Error("剪辑提交失败: " + JSON.stringify(edit));
console.log("✓ 剪辑任务已提交:", edit.task.id);

// 6. 轮询两个任务直至完成（最多 5 分钟）
const pending = new Set([music.task.id, edit.task.id]);
const deadline = Date.now() + 5 * 60 * 1000;
while (pending.size && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  const listRes = await req(`/api/projects/${proj.id}/tasks`);
  const list = await listRes.json();
  for (const task of list) {
    if (!pending.has(task.id)) continue;
    if (task.status === "succeeded") {
      console.log(`✓ 任务完成 [${task.kind}] -> asset=${task.outputAssetId}`);
      pending.delete(task.id);
    } else if (task.status === "failed") {
      console.error(`✗ 任务失败 [${task.kind}]: ${task.error}`);
      pending.delete(task.id);
      process.exitCode = 1;
    }
  }
}
if (pending.size) {
  console.error("✗ 超时未完成:", [...pending]);
  process.exitCode = 1;
}

// 7. 素材清单
const assetsRes = await req(`/api/projects/${proj.id}/assets`);
const assets = await assetsRes.json();
console.log("\n素材清单:");
for (const a of assets) {
  console.log(`  [${a.kind}] ${a.id} ${a.mime} ${(a.bytes / 1024).toFixed(0)}KB`);
}
console.log(process.exitCode ? "=== 存在失败 ===" : "=== 端到端全部通过 ===");
