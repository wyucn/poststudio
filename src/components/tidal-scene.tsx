"use client";

import { useEffect, useRef } from "react";
import type { BufferAttribute, WebGLRenderer } from "three";

type DisposeScene = () => void;

async function initializeTidalScene(
  host: HTMLDivElement,
  compact: boolean,
  isCancelled: () => boolean
): Promise<DisposeScene | undefined> {
  const THREE = await import("three");
  if (isCancelled()) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 0.15, compact ? 8.8 : 7.8);

  let renderer: WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch {
    host.dataset.webgl = "fallback";
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  host.dataset.webgl = "ready";

  scene.add(new THREE.HemisphereLight(0xf9fff0, 0x0d5f5a, 2.6));
  const limeLight = new THREE.PointLight(0xcfff48, 18, 15, 1.8);
  limeLight.position.set(-3.5, 2.8, 4.5);
  scene.add(limeLight);
  const papayaLight = new THREE.PointLight(0xff825e, 14, 14, 1.7);
  papayaLight.position.set(3.8, -2.2, 3.2);
  scene.add(papayaLight);

  const sculpture = new THREE.Group();
  sculpture.rotation.set(-0.08, -0.18, -0.14);
  scene.add(sculpture);

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xc9fff3,
    emissive: 0x063f3a,
    emissiveIntensity: 0.18,
    roughness: 0.1,
    metalness: 0,
    transmission: 0.92,
    thickness: 1.35,
    ior: 1.38,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    transparent: true,
    opacity: 0.94,
    side: THREE.DoubleSide,
  });
  const accentGlass = glass.clone();
  accentGlass.color.setHex(0xdfff8f);
  accentGlass.emissive.setHex(0x365000);
  accentGlass.emissiveIntensity = 0.12;

  // A deliberately abstract dolphin: recognisable in silhouette, sculptural up close.
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.78, 2.25, 10, 24),
    glass
  );
  body.rotation.z = Math.PI / 2;
  body.scale.set(1.08, 0.82, 0.92);
  sculpture.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.84, 32, 20), glass);
  head.position.set(1.35, 0.24, 0.04);
  head.scale.set(1.03, 0.86, 0.92);
  sculpture.add(head);

  const snout = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.18, 0.7, 8, 18),
    accentGlass
  );
  snout.rotation.z = Math.PI / 2;
  snout.position.set(2.12, 0.08, 0.2);
  snout.scale.set(1, 0.72, 0.7);
  sculpture.add(snout);

  const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.18, 3), glass);
  dorsal.position.set(-0.12, 0.96, -0.08);
  dorsal.rotation.set(0.12, 0.1, -0.2);
  dorsal.scale.z = 0.28;
  sculpture.add(dorsal);

  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.48, 1.3, 3), glass);
  fin.position.set(0.45, -0.62, 0.42);
  fin.rotation.set(-0.45, 0.08, 1.08);
  fin.scale.z = 0.22;
  sculpture.add(fin);

  const tailStem = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.24, 0.9, 8, 16),
    glass
  );
  tailStem.rotation.z = Math.PI / 2;
  tailStem.position.set(-1.78, -0.05, -0.02);
  sculpture.add(tailStem);

  for (const direction of [-1, 1]) {
    const fluke = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 1.25, 3),
      accentGlass
    );
    fluke.position.set(-2.42, direction * 0.38, -0.02);
    fluke.rotation.set(0, Math.PI / 2, direction * 0.92);
    fluke.scale.z = 0.2;
    sculpture.add(fluke);
  }

  const orbitMaterial = new THREE.MeshBasicMaterial({
    color: 0x0f6d67,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const orbits = new THREE.Group();
  scene.add(orbits);
  [2.35, 2.9, 3.48].forEach((radius, index) => {
    const orbit = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.012 + index * 0.003, 8, 160),
      orbitMaterial.clone()
    );
    orbit.rotation.set(1.2 - index * 0.25, 0.25 + index * 0.46, index * 0.32);
    orbits.add(orbit);
  });

  const particleCount = compact ? 130 : 240;
  const particlePositions = new Float32Array(particleCount * 3);
  const particleBaseY = new Float32Array(particleCount);
  const particleSeeds = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i += 1) {
    const angle = i * 2.399963;
    const radius = 2.15 + (((i * 37) % 100) / 100) * 2.35;
    particlePositions[i * 3] = Math.cos(angle) * radius;
    particlePositions[i * 3 + 1] =
      Math.sin(angle * 0.72) * (0.7 + radius * 0.28);
    particleBaseY[i] = particlePositions[i * 3 + 1];
    particlePositions[i * 3 + 2] = Math.sin(angle) * radius * 0.34 - 0.45;
    particleSeeds[i] = ((i * 67) % 101) / 101;
  }
  const particlesGeometry = new THREE.BufferGeometry();
  particlesGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(particlePositions, 3)
  );
  const particlesMaterial = new THREE.PointsMaterial({
    color: 0x4fdfd1,
    size: compact ? 0.038 : 0.048,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const particles = new THREE.Points(particlesGeometry, particlesMaterial);
  scene.add(particles);

  const target = new THREE.Vector2();
  const current = new THREE.Vector2();
  let frame = 0;
  let visible = true;

  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  const visibilityObserver =
    typeof IntersectionObserver === "undefined"
      ? undefined
      : new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
        });
  visibilityObserver?.observe(host);

  const onPointerMove = (event: PointerEvent) => {
    const rect = host.getBoundingClientRect();
    target.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    target.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  };
  const onPointerLeave = () => target.set(0, 0);
  host.addEventListener("pointermove", onPointerMove, { passive: true });
  host.addEventListener("pointerleave", onPointerLeave);

  const timer = new THREE.Timer();
  timer.connect(document);
  const render = (timestamp: number) => {
    if (!visible || document.hidden) {
      frame = window.requestAnimationFrame(render);
      return;
    }
    timer.update(timestamp);
    const elapsed = timer.getElapsed();
    current.lerp(target, 0.045);
    sculpture.rotation.y = -0.18 + current.x * 0.18 + elapsed * 0.045;
    sculpture.rotation.x =
      -0.08 - current.y * 0.1 + Math.sin(elapsed * 0.55) * 0.025;
    sculpture.position.y = Math.sin(elapsed * 0.72) * 0.09;
    orbits.rotation.y = elapsed * 0.055 + current.x * 0.05;
    orbits.rotation.x = current.y * -0.04;
    particles.rotation.z = elapsed * -0.012;
    particles.rotation.y = elapsed * 0.018;

    const position = particlesGeometry.attributes.position as BufferAttribute;
    for (let i = 0; i < particleCount; i += 1) {
      const baseY = particleBaseY[i];
      position.setY(
        i,
        baseY + Math.sin(elapsed * 0.62 + particleSeeds[i] * 8) * 0.045
      );
    }
    position.needsUpdate = true;
    renderer.render(scene, camera);
    frame = window.requestAnimationFrame(render);
  };

  resize();
  if (reduceMotion.matches) renderer.render(scene, camera);
  else frame = window.requestAnimationFrame(render);

  const onMotionChange = () => {
    window.cancelAnimationFrame(frame);
    if (reduceMotion.matches) {
      target.set(0, 0);
      current.set(0, 0);
      renderer.render(scene, camera);
    } else {
      timer.reset();
      frame = window.requestAnimationFrame(render);
    }
  };
  reduceMotion.addEventListener("change", onMotionChange);

  return () => {
    window.cancelAnimationFrame(frame);
    reduceMotion.removeEventListener("change", onMotionChange);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerleave", onPointerLeave);
    resizeObserver.disconnect();
    visibilityObserver?.disconnect();
    timer.dispose();
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) {
        return;
      }
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => material.dispose());
    });
    renderer.dispose();
    renderer.domElement.remove();
  };
}

export function TidalScene({ compact = false }: { compact?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let dispose: DisposeScene | undefined;
    let loadObserver: IntersectionObserver | undefined;
    let loadStarted = false;

    const load = () => {
      if (loadStarted) return;
      loadStarted = true;
      loadObserver?.disconnect();
      host.dataset.webgl = "loading";
      void initializeTidalScene(host, compact, () => cancelled)
        .then((nextDispose) => {
          if (!nextDispose) return;
          if (cancelled) nextDispose();
          else dispose = nextDispose;
        })
        .catch(() => {
          if (!cancelled) host.dataset.webgl = "fallback";
        });
    };

    if (typeof IntersectionObserver === "undefined") {
      load();
    } else {
      loadObserver = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) load();
        },
        { rootMargin: "160px" }
      );
      loadObserver.observe(host);
    }

    return () => {
      cancelled = true;
      loadObserver?.disconnect();
      dispose?.();
    };
  }, [compact]);

  return (
    <div
      ref={hostRef}
      className={compact ? "tidal-scene tidal-scene-compact" : "tidal-scene"}
      aria-hidden="true"
    >
      <div className="tidal-scene-fallback" />
    </div>
  );
}
