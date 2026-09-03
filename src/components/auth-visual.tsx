import { ImageIcon, Mic2, Music2, Video } from "lucide-react";
import { DolphinMark } from "@/components/dolphin-mark";
import { TidalScene } from "@/components/tidal-scene";

export function AuthVisual() {
  return (
    <section className="auth-visual" aria-label="Haitun Post Studio">
      <div className="auth-visual-brand">
        <span className="brand-liquid-mark">
          <DolphinMark />
        </span>
        <span>
          <strong>HAITUN.POST</strong>
          <small>海豚后期 / AIGC STUDIO</small>
        </span>
      </div>

      <div className="auth-scene-wrap">
        <TidalScene compact />
        <div className="auth-orbit-label auth-orbit-label-one">GENERATE</div>
        <div className="auth-orbit-label auth-orbit-label-two">COLLABORATE</div>
        <div className="auth-orbit-label auth-orbit-label-three">CREATE</div>
      </div>

      <div className="auth-visual-copy">
        <p>CREATIVE CURRENT · ALWAYS IN MOTION</p>
        <h1>
          让灵感
          <span>跃出屏幕</span>
        </h1>
        <p className="auth-visual-subline">
          图像、视频、音乐与配音，在一个项目空间里共同生长。
        </p>
        <div className="auth-capabilities" aria-label="创作能力">
          <span><ImageIcon /> 图像</span>
          <span><Video /> 视频</span>
          <span><Music2 /> 音乐</span>
          <span><Mic2 /> 配音</span>
        </div>
      </div>
    </section>
  );
}
