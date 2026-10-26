'use client';

import { useEffect, useRef, useState } from 'react';
import type { ClusterDTO, GraphEdgeDTO, GraphNodeDTO } from '@/lib/types';

type Props = {
  nodes: GraphNodeDTO[];
  edges: GraphEdgeDTO[];
  clusters: ClusterDTO[];
  focusIds: Set<string> | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

type Three = typeof import('three');

export default function SpaceCanvas({ nodes, edges, clusters, focusIds, selectedId, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelHostRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<Array<() => void>>([]);
  const [ready, setReady] = useState(false);
  const state = useRef<{
    THREE: Three | null;
    renderer: import('three').WebGLRenderer | null;
    scene: import('three').Scene | null;
    camera: import('three').PerspectiveCamera | null;
    controls: { update: () => void; target: import('three').Vector3; autoRotate: boolean; autoRotateSpeed: number; enabled: boolean } | null;
    texture: import('three').Texture | null;
    nodeGroup: import('three').Group | null;
    edgeLines: import('three').LineSegments | null;
    sprites: Array<{ mesh: import('three').Sprite; id: string; pos: import('three').Vector3; base: number; degree: number }>;
    labels: Array<{ el: HTMLDivElement; id: string; pos: import('three').Vector3; degree: number; width: number }>;
    focus: Set<string> | null;
    selected: string | null;
    fitted: boolean;
    hover: string | null;
  }>({
    THREE: null,
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    texture: null,
    nodeGroup: null,
    edgeLines: null,
    sprites: [],
    labels: [],
    focus: null,
    selected: null,
    fitted: false,
    hover: null,
  });

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  // ---------- 初始化场景（只跑一次） ----------
  useEffect(() => {
    let disposed = false;
    let frame = 0;

    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (disposed || !hostRef.current) return;

      const host = hostRef.current;
      const width = host.clientWidth || window.innerWidth;
      const height = host.clientHeight || window.innerHeight;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      renderer.setClearColor(0x04060c, 1);
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x04060c, 0.0016);

      const camera = new THREE.PerspectiveCamera(52, width / height, 1, 6000);
      camera.position.set(0, 40, 560);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.rotateSpeed = 0.55;
      controls.zoomSpeed = 0.8;
      controls.minDistance = 90;
      controls.maxDistance = 1800;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.28;
      controls.target.set(0, 0, 0);

      // 星尘
      const starCount = 900;
      const starPos = new Float32Array(starCount * 3);
      for (let i = 0; i < starCount; i++) {
        const r = 900 + Math.random() * 1600;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        starPos[i * 3 + 1] = r * Math.cos(phi);
        starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      }
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
      const stars = new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({ color: 0x21334f, size: 2.4, sizeAttenuation: true, transparent: true, opacity: 0.75 }),
      );
      scene.add(stars);

      // 光点纹理
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.22, 'rgba(255,255,255,0.95)');
      gradient.addColorStop(0.45, 'rgba(255,255,255,0.35)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;

      const nodeGroup = new THREE.Group();
      scene.add(nodeGroup);

      state.current = {
        ...state.current,
        THREE,
        renderer,
        scene,
        camera,
        controls: controls as unknown as typeof state.current.controls,
        texture,
        nodeGroup,
        edgeLines: null,
        sprites: [],
        labels: [],
      };

      // 交互
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let downAt = { x: 0, y: 0, t: 0 };

      const toNdc = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      };

      const onPointerDown = (event: PointerEvent) => {
        downAt = { x: event.clientX, y: event.clientY, t: Date.now() };
      };

      const onPointerUp = (event: PointerEvent) => {
        const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
        if (moved > 6 || Date.now() - downAt.t > 600) return;
        toNdc(event);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(state.current.sprites.map((s) => s.mesh), false);
        if (hits.length > 0) {
          const hit = state.current.sprites.find((s) => s.mesh === hits[0].object);
          selectRef.current(hit ? hit.id : null);
        } else {
          selectRef.current(null);
        }
      };

      const onPointerMove = (event: PointerEvent) => {
        toNdc(event);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(state.current.sprites.map((s) => s.mesh), false);
        const id = hits.length ? (state.current.sprites.find((s) => s.mesh === hits[0].object)?.id ?? null) : null;
        state.current.hover = id;
        renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
      };

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointerup', onPointerUp);
      renderer.domElement.addEventListener('pointermove', onPointerMove);

      const ro = new ResizeObserver(() => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      });
      ro.observe(host);

      const clock = new THREE.Clock();
      const project = new THREE.Vector3();

      const tick = () => {
        frame = requestAnimationFrame(tick);
        const t = clock.getElapsedTime();
        stars.rotation.y = t * 0.008;
        stars.rotation.x = Math.sin(t * 0.04) * 0.03;

        for (const sprite of state.current.sprites) {
          const dim = state.current.focus && !state.current.focus.has(sprite.id);
          const isSelected = state.current.selected === sprite.id;
          const isHover = state.current.hover === sprite.id;
          const breathe = 1 + Math.sin(t * 1.1 + sprite.pos.x * 0.01) * 0.035;
          const scale = sprite.base * breathe * (isSelected ? 1.75 : isHover ? 1.3 : dim ? 0.62 : 1);
          sprite.mesh.scale.set(scale, scale, 1);
          const material = sprite.mesh.material as import('three').SpriteMaterial;
          material.opacity = dim ? 0.14 : isSelected ? 1 : 0.92;
        }

        if (state.current.edgeLines) {
          const material = state.current.edgeLines.material as import('three').LineBasicMaterial;
          material.opacity = state.current.focus ? 0.34 : 0.5;
        }

        controls.update();
        renderer.render(scene, camera);

        // 标签投影 + 屏幕空间避让：重叠时只保留更重要的那个
        const w = renderer.domElement.clientWidth;
        const h = renderer.domElement.clientHeight;
        const rects: Array<[number, number, number, number]> = [];
        const ordered = [...state.current.labels].sort((a, b) => {
          const sa = a.id === state.current.selected ? 2 : a.id === state.current.hover ? 1 : 0;
          const sb = b.id === state.current.selected ? 2 : b.id === state.current.hover ? 1 : 0;
          return sb - sa || b.degree - a.degree;
        });
        for (const label of ordered) {
          project.copy(label.pos).project(camera);
          const visible = project.z < 1 && project.z > -1;
          const x = (project.x * 0.5 + 0.5) * w;
          const y = (-project.y * 0.5 + 0.5) * h;
          if (!visible || x < -60 || x > w + 60 || y < -30 || y > h + 30) {
            label.el.style.display = 'none';
            continue;
          }
          const lw = label.width;
          const lh = 17;
          if (x - lw / 2 < 8 || x + lw / 2 > w - 8) {
            label.el.style.display = 'none';
            continue;
          }
          const left = x - lw / 2;
          const top = y;
          const collides = rects.some(
            (r) => left < r[0] + r[2] + 4 && left + lw + 4 > r[0] && top < r[1] + r[3] + 2 && top + lh + 2 > r[1],
          );
          if (collides) {
            label.el.style.display = 'none';
            continue;
          }
          rects.push([left, top, lw, lh]);
          label.el.style.display = '';
          label.el.style.transform = `translate(-50%, 0) translate(${x}px, ${y}px)`;
          const dim = state.current.focus && !state.current.focus.has(label.id);
          label.el.style.opacity = dim ? '0.12' : '';
        }
      };
      frame = requestAnimationFrame(tick);

      cleanupRef.current = [
        () => cancelAnimationFrame(frame),
        () => ro.disconnect(),
        () => {
          renderer.domElement.removeEventListener('pointerdown', onPointerDown);
          renderer.domElement.removeEventListener('pointerup', onPointerUp);
          renderer.domElement.removeEventListener('pointermove', onPointerMove);
        },
        () => controls.dispose(),
        () => {
          starGeo.dispose();
          texture.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        },
      ];
      setReady(true);
    })();

    return () => {
      disposed = true;
      for (const fn of cleanupRef.current) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
      cleanupRef.current = [];
    };
  }, []);

  // ---------- 数据 → 场景 ----------
  useEffect(() => {
    const s = state.current;
    const THREE = s.THREE;
    if (!THREE || !s.nodeGroup || !s.scene) return;

    // 清空旧对象
    for (const sprite of s.sprites) {
      s.nodeGroup.remove(sprite.mesh);
      (sprite.mesh.material as import('three').SpriteMaterial).dispose();
    }
    s.sprites = [];
    s.nodeGroup.clear();

    if (s.edgeLines) {
      s.scene.remove(s.edgeLines);
      s.edgeLines.geometry.dispose();
      (s.edgeLines.material as import('three').Material).dispose();
      s.edgeLines = null;
    }

    const clusterColor = new Map(clusters.map((c) => [c.id, c.color]));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    for (const node of nodes) {
      const color = node.status === 'duplicate' ? '#ff7ad9' : node.cluster_id ? (clusterColor.get(node.cluster_id) ?? '#57d4ff') : '#5b6b8a';
      const material = new THREE.SpriteMaterial({
        map: s.texture,
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        depthTest: true,
      });
      const sprite = new THREE.Sprite(material);
      const base = 17 + Math.min(node.degree, 14) * 1.35;
      sprite.position.set(node.x, node.y, node.z);
      sprite.userData.id = node.id;
      s.nodeGroup.add(sprite);
      s.sprites.push({ mesh: sprite, id: node.id, pos: sprite.position, base, degree: node.degree });
    }

    // 边
    const positions: number[] = [];
    const colors: number[] = [];
    const cWeak = new THREE.Color('#0d1930');
    const cStrong = new THREE.Color('#57d4ff');
    for (const edge of edges) {
      const a = nodeById.get(edge.source);
      const b = nodeById.get(edge.target);
      if (!a || !b) continue;
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const mix = Math.max(0, Math.min(1, (edge.strength - 30) / 70));
      const color = cWeak.clone().lerp(cStrong, mix);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, lineMat);
    s.scene.add(lines);
    s.edgeLines = lines;

    // 标签（按度数取前 140 个）
    const host = labelHostRef.current;
    if (host) {
      host.innerHTML = '';
      const picked = [...nodes].sort((a, b) => b.degree - a.degree).slice(0, 140);
      s.labels = picked.map((node) => {
        const el = document.createElement('div');
        el.className = 'node-label';
        el.textContent = node.content.length > 26 ? `${node.content.slice(0, 26)}…` : node.content;
        host.appendChild(el);
        return {
          el,
          id: node.id,
          pos: new THREE.Vector3(node.x, node.y, node.z),
          degree: node.degree,
          width: Math.min(el.offsetWidth || 130, 170),
        };
      });
    }

    // 首次自动取景：用 90 分位半径，避免一个孤立节点把整张图推得太远
    if (!s.fitted && nodes.length > 0 && s.camera && s.controls) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const node of nodes) {
        cx += node.x;
        cy += node.y;
        cz += node.z;
      }
      cx /= nodes.length;
      cy /= nodes.length;
      cz /= nodes.length;
      const distances = nodes
        .map((node) => Math.hypot(node.x - cx, node.y - cy, node.z - cz))
        .sort((a, b) => a - b);
      const idx = Math.max(0, Math.floor(distances.length * 0.9) - 1);
      const maxR = Math.max(distances[idx] ?? 0, 90);
      const vFov = (s.camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * s.camera.aspect);
      const fit = Math.max(maxR / Math.sin(vFov / 2), maxR / Math.sin(hFov / 2));
      s.controls.target.set(cx, cy, cz);
      s.camera.position.set(cx, cy + maxR * 0.18, cz + fit * 1.22 + 30);
      s.camera.near = 1;
      s.camera.far = maxR * 12 + 3000;
      s.camera.updateProjectionMatrix();
      s.fitted = true;
    }
  }, [nodes, edges, clusters, ready]);

  // ---------- 过滤 / 选中同步 ----------
  useEffect(() => {
    state.current.focus = focusIds;
    state.current.selected = selectedId;
    if (state.current.controls) {
      state.current.controls.autoRotate = !selectedId;
    }
  }, [focusIds, selectedId]);

  return (
    <>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      <div ref={labelHostRef} className="labels" />
    </>
  );
}
