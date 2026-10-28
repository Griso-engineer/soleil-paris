// Scène 3D : une pièce, sa façade, la fenêtre et la protection, éclairées par le
// soleil de Paris. Le repère est celui de shading.js (z = normale sortante).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sunVectorLocal, COLORS } from './shading.js';

const WALL_HALF = 4.5;
const ROOM_HALF = 2.2;
const ROOM_DEPTH = 5.5;
const CEIL = 2.7;
const TOP = 2.95;
const INNER = -0.2; // nu intérieur du mur de façade
const GROUND_Y = -0.35;
const SUN_DIST = 30;

const BSO_SLAT = { w: 0.08, s: 0.072 };
const PERSIENNE = { w: 0.05, s: 0.04, beta: 45 };

export function sillHeight(H) {
  return H >= 2 ? 0 : Math.min(0.9, 2.5 - H);
}

export class SolarScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.localClippingEnabled = true;
    // Plan de coupe vertical passant par l'axe de la fenêtre (on garde x ≤ 0).
    // Les ombres restent calculées sur la géométrie entière (clipShadows = false).
    this.clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0.001);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 40;
    // La molette fait défiler la page ; Ctrl (ou Cmd) + molette zoome dans la vue.
    container.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    }, { capture: true });

    this.hemi = new THREE.HemisphereLight(0xdde8ff, 0x8a7f6a, 0.8);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 60;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.015;
    this.sun.target.position.set(0, 1, -1.5);
    this.scene.add(this.sun, this.sun.target);

    this.sunDisc = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd36b, fog: false })
    );
    this.scene.add(this.sunDisc);

    this.buildGround();
    this.building = new THREE.Group();
    this.scene.add(this.building);
    this.prot = new THREE.Group();
    this.scene.add(this.prot);
    this.paths = new THREE.Group();
    this.scene.add(this.paths);
    this.compass = new THREE.Group();
    this.scene.add(this.compass);

    this.view = 'ext';
    this.setView('ext');

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();

    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  buildGround() {
    const g = new THREE.Mesh(
      new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({ color: 0xd9d7d1, roughness: 1 })
    );
    g.rotation.x = -Math.PI / 2;
    g.position.y = GROUND_Y;
    g.receiveShadow = true;
    this.scene.add(g);
  }

  setView(view) {
    this.view = view;
    const views = {
      ext: { pos: [5.5, 2.4, 8.5], target: [0, 1.4, 0] },
      int: { pos: [1.4, 1.6, -5.0], target: [-0.1, 1.2, 0] },
      coupe: { pos: [7.2, 1.9, -1.0], target: [0, 1.3, -1.0] },
    };
    const v = views[view];
    this.camera.position.set(...v.pos);
    this.controls.target.set(...v.target);
    this.controls.update();
    this.applyClip();
  }

  applyClip() {
    const planes = this.view === 'coupe' ? [this.clipPlane] : [];
    for (const group of [this.building, this.prot]) {
      if (!group) continue;
      group.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          m.clippingPlanes = planes;
          m.clipShadows = false;
          if (o.isMesh) m.side = THREE.DoubleSide;
        }
      });
    }
  }

  // ---------- Bâtiment ----------

  setBuilding(cfg) {
    const key = [cfg.W, cfg.H, cfg.e].join('|');
    if (key === this.buildingKey) return;
    this.buildingKey = key;
    disposeGroup(this.building);

    const { W, H, e } = cfg;
    const sill = sillHeight(H);
    this.sill = sill;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf2f1ee, roughness: 0.95 });
    const roomMat = new THREE.MeshStandardMaterial({ color: 0xf7f7f5, roughness: 0.9 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xc9a77c, roughness: 0.8 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf8f8f6, roughness: 0.6 });

    const add = (geo, mat, x, y, z, target = this.building) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      target.add(m);
      return m;
    };
    const box = (x0, x1, y0, y1, z0, z1, mat) =>
      add(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

    // Façade percée
    box(-WALL_HALF, -W / 2, GROUND_Y, TOP, INNER, e, wallMat);
    box(W / 2, WALL_HALF, GROUND_Y, TOP, INNER, e, wallMat);
    if (sill > 0) box(-W / 2, W / 2, GROUND_Y, sill, INNER, e, wallMat);
    box(-W / 2, W / 2, sill + H, TOP, INNER, e, wallMat);

    // Pièce
    box(-ROOM_HALF, ROOM_HALF, -0.25, 0, -ROOM_DEPTH, INNER, floorMat); // plancher
    box(-ROOM_HALF, ROOM_HALF, CEIL, TOP, -ROOM_DEPTH, INNER, roomMat); // plafond
    box(-ROOM_HALF, ROOM_HALF, -0.25, TOP, -ROOM_DEPTH - 0.15, -ROOM_DEPTH, roomMat); // fond
    box(-ROOM_HALF - 0.15, -ROOM_HALF, -0.25, TOP, -ROOM_DEPTH - 0.15, INNER, roomMat); // gauche
    box(ROOM_HALF, ROOM_HALF + 0.15, -0.25, TOP, -ROOM_DEPTH - 0.15, INNER, roomMat); // droite
    // Dalle du dessous, pour que la pièce paraisse à l'étage
    box(-WALL_HALF, WALL_HALF, GROUND_Y, -0.25, -ROOM_DEPTH - 0.15, INNER, wallMat);

    // Repère au sol : grille de 50 cm pour lire la profondeur de la tache solaire
    const grid = new THREE.GridHelper(ROOM_DEPTH, Math.round(ROOM_DEPTH / 0.5), 0x9b7d58, 0xb08f68);
    grid.scale.set((2 * ROOM_HALF) / ROOM_DEPTH, 1, 1);
    grid.position.set(0, 0.002, INNER - ROOM_DEPTH / 2);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    this.building.add(grid);

    // Menuiserie
    const f = 0.05;
    const fd = 0.07;
    box(-W / 2, -W / 2 + f, sill, sill + H, -fd / 2, fd / 2, frameMat);
    box(W / 2 - f, W / 2, sill, sill + H, -fd / 2, fd / 2, frameMat);
    box(-W / 2, W / 2, sill, sill + f, -fd / 2, fd / 2, frameMat);
    box(-W / 2, W / 2, sill + H - f, sill + H, -fd / 2, fd / 2, frameMat);
    if (W > 0.9) box(-f / 2, f / 2, sill, sill + H, -fd / 2, fd / 2, frameMat);

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshPhysicalMaterial({
        color: 0xbfd8e6, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0, side: THREE.DoubleSide,
      })
    );
    glass.position.set(0, sill + H / 2, 0);
    this.building.add(glass);
    this.applyClip();
  }

  // ---------- Protections ----------

  setProtection(cfg) {
    disposeGroup(this.prot);
    const { W, H, e } = cfg;
    const sill = sillHeight(H);
    const color = new THREE.Color(COLORS[cfg.color].hex);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide });
    const zp = Math.max(0.02, e - 0.05);
    const d = Math.max(0, Math.min(1, cfg.deploy));
    const g = this.prot;
    const add = (geo, m, x, y, z, parent = g) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const slats = (parent, x0, x1, yTop, height, z, slat, beta, thick = 0.006) => {
      const n = Math.round(height / slat.s);
      const geo = new THREE.BoxGeometry(x1 - x0, thick, slat.w);
      for (let i = 0; i < n; i++) {
        const m = add(geo, mat, (x0 + x1) / 2, yTop - (i + 0.5) * slat.s, z, parent);
        m.rotation.x = beta * Math.PI / 180;
      }
    };

    switch (cfg.type) {
      case 'roulant': {
        const h = H * d;
        // Coulisses
        add(new THREE.BoxGeometry(0.03, H, 0.05), mat, -W / 2 + 0.015, sill + H / 2, zp);
        add(new THREE.BoxGeometry(0.03, H, 0.05), mat, W / 2 - 0.015, sill + H / 2, zp);
        if (h > 0.005) {
          const tex = stripeTexture(color, cfg.ajoure && d >= 0.999);
          tex.repeat.set(1, h / 0.04);
          const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
          add(new THREE.BoxGeometry(W - 0.03, h, 0.014), m, 0, sill + H - h / 2, zp);
        }
        break;
      }
      case 'screen': {
        const h = H * d;
        add(new THREE.BoxGeometry(0.03, H, 0.04), mat, -W / 2 + 0.015, sill + H / 2, zp);
        add(new THREE.BoxGeometry(0.03, H, 0.04), mat, W / 2 - 0.015, sill + H / 2, zp);
        if (h > 0.005) {
          const fab = new THREE.MeshStandardMaterial({
            color, roughness: 0.9, transparent: true, opacity: 0.82 - cfg.openness / 40, side: THREE.DoubleSide,
          });
          add(new THREE.BoxGeometry(W - 0.03, h, 0.003), fab, 0, sill + H - h / 2, zp);
          add(new THREE.BoxGeometry(W - 0.03, 0.03, 0.03), mat, 0, sill + H - h, zp);
        }
        break;
      }
      case 'bso': {
        const h = H * d;
        add(new THREE.BoxGeometry(0.025, H, 0.04), mat, -W / 2 + 0.0125, sill + H / 2, zp);
        add(new THREE.BoxGeometry(0.025, H, 0.04), mat, W / 2 - 0.0125, sill + H / 2, zp);
        if (h > 0.01) slats(g, -W / 2 + 0.02, W / 2 - 0.02, sill + H, h, zp, BSO_SLAT, cfg.slatAngle);
        break;
      }
      case 'accordeon': {
        const c = (W / 2) * d;
        for (const side of [-1, 1]) {
          const x0 = side < 0 ? -W / 2 : W / 2 - c;
          const x1 = side < 0 ? -W / 2 + c : W / 2;
          if (c > 0.02) {
            if (cfg.louvered) {
              slats(g, x0, x1, sill + H, H, zp, PERSIENNE, PERSIENNE.beta, 0.004);
              // montants des panneaux
              const panels = Math.max(1, Math.round(c / 0.18));
              for (let i = 0; i <= panels; i++) {
                add(new THREE.BoxGeometry(0.015, H, 0.03), mat, x0 + (i / panels) * (x1 - x0), sill + H / 2, zp);
              }
            } else {
              add(new THREE.BoxGeometry(x1 - x0, H, 0.015), mat, (x0 + x1) / 2, sill + H / 2, zp);
            }
          }
          // Paquet replié contre le tableau
          const pack = 0.04 + 0.06 * (1 - d);
          const px = side < 0 ? -W / 2 + pack / 2 : W / 2 - pack / 2;
          if (d < 0.98) add(new THREE.BoxGeometry(pack, H, 0.05), mat, px, sill + H / 2, zp);
        }
        break;
      }
      case 'battants': {
        const L = W / 2;
        const a = cfg.openAngle * Math.PI / 180;
        for (const side of [-1, 1]) {
          const pivot = new THREE.Group();
          pivot.position.set((side * W) / 2, sill, e + 0.015);
          pivot.rotation.y = side < 0 ? -a : a;
          g.add(pivot);
          const dir = -side; // le vantail s'étend vers le centre quand il est fermé
          const cx = (dir * L) / 2;
          const st = 0.06;
          if (cfg.louvered) {
            add(new THREE.BoxGeometry(st, H, 0.03), mat, dir * st / 2, H / 2, 0, pivot);
            add(new THREE.BoxGeometry(st, H, 0.03), mat, dir * (L - st / 2), H / 2, 0, pivot);
            add(new THREE.BoxGeometry(L, st, 0.03), mat, cx, st / 2, 0, pivot);
            add(new THREE.BoxGeometry(L, st, 0.03), mat, cx, H - st / 2, 0, pivot);
            const geo = new THREE.BoxGeometry(L - 2 * st, 0.005, PERSIENNE.w);
            const n = Math.round((H - 2 * st) / PERSIENNE.s);
            for (let i = 0; i < n; i++) {
              const m = add(geo, mat, cx, H - st - (i + 0.5) * PERSIENNE.s, 0, pivot);
              m.rotation.x = PERSIENNE.beta * Math.PI / 180;
            }
          } else {
            add(new THREE.BoxGeometry(L, H, 0.03), mat, cx, H / 2, 0, pivot);
            // barres et écharpe en Z, pour l'allure
            add(new THREE.BoxGeometry(L * 0.9, 0.08, 0.012), mat, cx, H * 0.2, 0.02, pivot);
            add(new THREE.BoxGeometry(L * 0.9, 0.08, 0.012), mat, cx, H * 0.8, 0.02, pivot);
          }
        }
        break;
      }
      case 'banne': {
        const P = cfg.bannePro * d;
        const margin = 0.3;
        const pivot = new THREE.Group();
        pivot.position.set(0, sill + H + 0.25, e);
        pivot.rotation.x = cfg.banneAngle * Math.PI / 180;
        g.add(pivot);
        add(new THREE.BoxGeometry(W + 2 * margin, 0.12, 0.12), mat, 0, 0.05, 0.06, g).position.set(0, sill + H + 0.3, e + 0.06);
        if (P > 0.02) {
          const tex = stripeTexture(color, false, true);
          tex.repeat.set((W + 2 * margin) / 0.25, 1);
          const fab = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide });
          add(new THREE.BoxGeometry(W + 2 * margin, 0.008, P), fab, 0, 0, P / 2, pivot);
          add(new THREE.BoxGeometry(W + 2 * margin, 0.05, 0.05), mat, 0, 0, P, pivot);
        }
        break;
      }
      default:
        break;
    }
    this.applyClip();
  }

  // ---------- Soleil ----------

  setSun(sun, facadeAz) {
    const s = sunVectorLocal(sun.altitude, sun.azimuth, facadeAz);
    const v = new THREE.Vector3(s.x, s.y, s.z);
    const t = this.sun.target.position;
    this.sun.position.copy(t).addScaledVector(v, 20);
    this.sunDisc.position.copy(v).multiplyScalar(SUN_DIST);
    const up = Math.max(0, Math.min(1, sun.altitude / 12));
    this.sun.intensity = sun.altitude > 0 ? 3.2 * up : 0;
    this.sun.visible = sun.altitude > -1;
    this.sunDisc.visible = sun.altitude > -1;
    // Teinte du soleil et du ciel selon sa hauteur
    const warm = new THREE.Color(0xffa45c).lerp(new THREE.Color(0xfff4e2), up);
    this.sun.color.copy(warm);
    this.sunDisc.material.color.copy(new THREE.Color(0xff9b4a).lerp(new THREE.Color(0xffe08a), up));
    const night = new THREE.Color(0x1b1d22);
    const dusk = new THREE.Color(0xffca7d);
    const day = new THREE.Color(0xd6e6fb);
    const sky = sun.altitude < 0
      ? night.clone().lerp(dusk, Math.max(0, 1 + sun.altitude / 8))
      : dusk.clone().lerp(day, Math.min(1, sun.altitude / 20));
    this.scene.background = sky;
    this.hemi.intensity = sun.altitude > 0 ? 0.6 + 0.6 * Math.min(1, sun.altitude / 30) : 0.35;
    this.ambient.intensity = sun.altitude > 0 ? 0.45 : 0.25;
    this.hemi.color.copy(sky);
  }

  setPaths(paths, facadeAz) {
    disposeGroup(this.paths);
    for (const p of paths) {
      const pts = p.points
        .filter((q) => q.altitude > -3)
        .map((q) => {
          const s = sunVectorLocal(q.altitude, q.azimuth, facadeAz);
          return new THREE.Vector3(s.x, s.y, s.z).multiplyScalar(SUN_DIST);
        });
      if (pts.length < 2) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = p.dashed
        ? new THREE.LineDashedMaterial({ color: p.color, dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.7 })
        : new THREE.LineBasicMaterial({ color: p.color });
      const line = new THREE.Line(geo, mat);
      if (p.dashed) line.computeLineDistances();
      this.paths.add(line);
    }
    this.setCompass(facadeAz);
  }

  setCompass(facadeAz) {
    if (this.compassAz === facadeAz) return;
    this.compassAz = facadeAz;
    disposeGroup(this.compass);
    const R = 14;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(R - 0.04, R + 0.04, 128),
      new THREE.MeshBasicMaterial({ color: 0x6f6a5f, transparent: true, opacity: 0.5 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = GROUND_Y + 0.01;
    this.compass.add(ring);
    const labels = [['N', 0], ['E', 90], ['S', 180], ['O', 270]];
    for (const [txt, az] of labels) {
      const s = sunVectorLocal(0, az, facadeAz);
      const sp = textSprite(txt, txt === 'N' ? '#fa554f' : '#111110');
      sp.position.set(s.x * (R + 1.2), GROUND_Y + 0.6, s.z * (R + 1.2));
      this.compass.add(sp);
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.02, 1.2),
        new THREE.MeshBasicMaterial({ color: txt === 'N' ? 0xfa554f : 0x111110 })
      );
      tick.position.set(s.x * R, GROUND_Y + 0.02, s.z * R);
      tick.lookAt(0, GROUND_Y + 0.02, 0);
      this.compass.add(tick);
    }
  }
}

// ---------- Utilitaires ----------

function disposeGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
  }
}

function stripeTexture(color, ajoure, vertical = false) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  const base = `#${color.getHexString()}`;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  if (vertical) {
    ctx.fillRect(0, 0, 32, 64);
  } else {
    ctx.fillRect(0, 58, 64, 6);
    if (ajoure) {
      ctx.fillStyle = 'rgba(255,250,230,0.9)';
      for (let x = 4; x < 64; x += 12) ctx.fillRect(x, 59, 5, 4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function textSprite(text, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = 'bold 68px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(1.6, 1.6, 1);
  return sp;
}
