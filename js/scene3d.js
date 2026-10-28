// Scène 3D dessinée : axonométrie en noir et blanc, à la manière d'un relevé.
// Une pièce d'immeuble parisien, sa façade en pierre, la fenêtre et la protection,
// éclairées par le soleil de Paris. Repère de shading.js (z = normale sortante).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sunVectorLocal } from './shading.js';

const WALL_HALF = 3.2;
const ROOM_HALF = 2.2;
const ROOM_DEPTH = 5.0;
const CEIL = 2.8;
const SLAB = 0.25;
const WALL_BOTTOM = -0.95;
const WALL_TOP = 3.75;
const INNER = -0.2; // nu intérieur du mur de façade
const DOME = 2.9; // rayon de la course du soleil dessinée autour de la fenêtre

const AMBIENT = 2.3; // gris de l'ombre : ~#dcdcdc
const INK = 0x111110;
const GREY = 0x9a9994;
const SUN_FILL = '#ffca7d';

const BSO_SLAT = { w: 0.08, s: 0.072 };
const PERSIENNE = { w: 0.05, s: 0.04, beta: 45 };

// Teintes des protections, traduites en valeurs de gris
const FILL = { clair: 0xffffff, moyen: 0xcfcecb, fonce: 0x7a7974 };

export function sillHeight(H) {
  return H >= 2 ? 0 : Math.min(0.9, 2.5 - H);
}

// Ombre propre et portée en deux tons : blanc au soleil, gris clair à l'ombre.
const TOON = (() => {
  const t = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 255, 255, 255, 255]), 2, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

function paper(color = 0xffffff, opts = {}) {
  return new THREE.MeshToonMaterial({
    color, gradientMap: TOON, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...opts,
  });
}
const lineMat = () => new THREE.LineBasicMaterial({ color: INK });
const greyLine = () => new THREE.LineBasicMaterial({ color: GREY });

export class SolarScene {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    // Plan de coupe vertical passant par l'axe de la fenêtre (on garde x ≤ 0).
    // Les ombres restent calculées sur la géométrie entière (clipShadows = false).
    this.clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0.001);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 200);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minZoom = 0.5;
    this.controls.maxZoom = 4;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    // La molette fait défiler la page ; Ctrl (ou Cmd) + molette zoome dans la vue.
    container.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    }, { capture: true });

    this.ambient = new THREE.AmbientLight(0xffffff, AMBIENT);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -7; sc.right = 7; sc.top = 7; sc.bottom = -7; sc.near = 1; sc.far = 60;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.building = new THREE.Group();
    this.prot = new THREE.Group();
    this.sunGroup = new THREE.Group();
    this.north = new THREE.Group();
    this.scene.add(this.building, this.prot, this.sunGroup, this.north);
    this.hidden = { int: [], coupe: [] };

    this.view = 'ext';
    this.center = new THREE.Vector3(0, 1.4, 0);

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
    this.aspect = w / h;
    this.updateFrustum();
  }

  updateFrustum() {
    const half = this.viewHalf || 3.2;
    const a = this.aspect || 1.6;
    this.camera.left = -half * a;
    this.camera.right = half * a;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
  }

  setView(view) {
    this.view = view;
    const c = this.center;
    const views = {
      // axonométrie depuis la rue, légèrement de biais
      ext: { dir: [0.95, 0.72, 1.0], target: [c.x, c.y + 0.5, 0.8], half: 2.7 },
      // pièce vue d'en haut, plafond et deux murs ôtés
      int: { dir: [0.9, 1.25, -1.05], target: [0, 0.9, -1.9], half: 3.3 },
      // coupe par l'axe de la fenêtre
      coupe: { dir: [1, 0.42, 0.32], target: [0, 1.5, -0.9], half: 2.9 },
    };
    const v = views[view];
    const d = new THREE.Vector3(...v.dir).normalize().multiplyScalar(30);
    this.controls.target.set(...v.target);
    this.camera.position.copy(this.controls.target).add(d);
    this.camera.zoom = 1;
    this.viewHalf = v.half;
    this.updateFrustum();
    this.controls.update();
    this.applyHidden();
    this.north.visible = view === 'ext';
    this.sunGroup.visible = view !== 'int';
    this.applyClip();
  }

  // Les murs ôtés pour la vue intérieure ne s'écrivent plus à l'écran mais portent
  // toujours leur ombre : la passe d'ombre ignore colorWrite.
  applyHidden() {
    const hide = new Set(this.hidden[this.view] || []);
    for (const list of Object.values(this.hidden)) {
      for (const o of list) {
        const h = hide.has(o);
        o.material.colorWrite = !h;
        o.material.depthWrite = !h;
        for (const c of o.children) c.visible = !h;
      }
    }
  }

  applyClip() {
    const planes = this.view === 'coupe' ? [this.clipPlane] : [];
    for (const group of [this.building, this.prot]) {
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
    this.hidden = { int: [], coupe: [] };

    const { W, H, e } = cfg;
    const sill = sillHeight(H);
    this.sill = sill;
    this.cfg = cfg;
    this.center.set(0, sill + H / 2, e);
    const g = this.building;
    const stone = paper(0xffffff);
    const floorMat = paper(0xffffff);
    const top = sill + H;

    // --- Façade en pierre, percée de la baie (un seul volume, pour un trait continu) ---
    const shape = new THREE.Shape();
    shape.moveTo(-WALL_HALF, WALL_BOTTOM);
    shape.lineTo(WALL_HALF, WALL_BOTTOM);
    shape.lineTo(WALL_HALF, WALL_TOP);
    shape.lineTo(-WALL_HALF, WALL_TOP);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-W / 2, sill);
    hole.lineTo(-W / 2, top);
    hole.lineTo(W / 2, top);
    hole.lineTo(W / 2, sill);
    hole.closePath();
    shape.holes.push(hole);
    const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: e - INNER, bevelEnabled: false });
    const wall = new THREE.Mesh(wallGeo, stone);
    wall.position.z = INNER;
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.add(new THREE.LineSegments(new THREE.EdgesGeometry(wallGeo, 20), lineMat()));
    g.add(wall);

    // Bandeaux filants au droit des planchers
    const band = (y0, y1, proud) => box(g, -WALL_HALF, WALL_HALF, y0, y1, e, e + proud, stone, { cast: false });
    band(-SLAB - 0.05, 0.02, 0.06);
    band(CEIL + SLAB - 0.04, CEIL + SLAB + 0.16, 0.09);
    band(CEIL + SLAB + 0.16, CEIL + SLAB + 0.22, 0.13);

    // Refends : joints horizontaux de la pierre, interrompus par la baie et son chambranle
    const joints = [];
    const pitch = 0.36;
    for (let y = WALL_BOTTOM + pitch; y < WALL_TOP - 0.05; y += pitch) {
      if (y > -SLAB - 0.06 && y < 0.03) continue;
      if (y > CEIL + SLAB - 0.05 && y < CEIL + SLAB + 0.23) continue;
      const z = e + 0.002;
      if (y > sill - 0.02 && y < top + 0.14) {
        joints.push(-WALL_HALF, y, z, -W / 2 - 0.12, y, z, W / 2 + 0.12, y, z, WALL_HALF, y, z);
      } else {
        joints.push(-WALL_HALF, y, z, WALL_HALF, y, z);
      }
    }
    g.add(segments(joints, greyLine()));

    // Chambranle autour de la baie
    const ch = 0.12;
    const cz = 0.025;
    box(g, -W / 2 - ch, -W / 2, sill, top + ch, e, e + cz, stone, { cast: false });
    box(g, W / 2, W / 2 + ch, sill, top + ch, e, e + cz, stone, { cast: false });
    box(g, -W / 2 - ch, W / 2 + ch, top, top + ch, e, e + cz, stone, { cast: false });
    if (sill > 0) box(g, -W / 2 - ch, W / 2 + ch, sill - 0.06, sill, e, e + 0.06, stone, { cast: false });

    // Prolongements du mur en tirets : l'immeuble continue au-dessus et au-dessous
    const dash = new THREE.LineDashedMaterial({ color: INK, dashSize: 0.14, gapSize: 0.09 });
    const conts = [];
    for (const x of [-WALL_HALF, WALL_HALF]) {
      conts.push(x, WALL_TOP, e, x, WALL_TOP + 0.9, e, x, WALL_BOTTOM, e, x, WALL_BOTTOM - 0.7, e);
    }
    conts.push(-WALL_HALF, WALL_TOP, INNER, -WALL_HALF, WALL_TOP + 0.9, INNER);
    const contLines = segments(conts, dash);
    contLines.computeLineDistances();
    g.add(contLines);

    // --- Pièce ---
    box(g, -ROOM_HALF, ROOM_HALF, -SLAB, 0, -ROOM_DEPTH, INNER, floorMat); // plancher
    // matériaux propres aux parois ôtables (voir applyHidden)
    const ceiling = box(g, -ROOM_HALF, ROOM_HALF, CEIL, CEIL + SLAB, -ROOM_DEPTH, INNER, paper());
    const back = box(g, -ROOM_HALF, ROOM_HALF, -SLAB, CEIL + SLAB, -ROOM_DEPTH - 0.15, -ROOM_DEPTH, paper());
    box(g, -ROOM_HALF - 0.15, -ROOM_HALF, -SLAB, CEIL + SLAB, -ROOM_DEPTH - 0.15, INNER, stone);
    const right = box(g, ROOM_HALF, ROOM_HALF + 0.15, -SLAB, CEIL + SLAB, -ROOM_DEPTH - 0.15, INNER, paper());
    this.hidden.int.push(ceiling, back, right);

    // Parquet à l'anglaise : lames parallèles à la façade
    const planks = [];
    for (let z = INNER - 0.14; z > -ROOM_DEPTH; z -= 0.14) planks.push(-ROOM_HALF, 0.002, z, ROOM_HALF, 0.002, z);
    g.add(segments(planks, greyLine()));
    // Plinthes
    box(g, -ROOM_HALF, -ROOM_HALF + 0.015, 0, 0.1, -ROOM_DEPTH, INNER, stone, { cast: false });
    box(g, -ROOM_HALF, ROOM_HALF, 0, 0.1, -ROOM_DEPTH, -ROOM_DEPTH + 0.015, stone, { cast: false });

    // Une table et une chaise, pour l'échelle
    const tx = -0.6;
    const tz = -2.3;
    box(g, tx - 0.6, tx + 0.6, 0.72, 0.76, tz - 0.4, tz + 0.4, stone);
    for (const [lx, lz] of [[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.35], [0.55, 0.35]]) {
      box(g, tx + lx - 0.02, tx + lx + 0.02, 0, 0.72, tz + lz - 0.02, tz + lz + 0.02, stone);
    }
    const cx = tx + 0.15;
    const cz2 = tz - 0.75;
    box(g, cx - 0.21, cx + 0.21, 0.44, 0.47, cz2 - 0.2, cz2 + 0.2, stone);
    box(g, cx - 0.21, cx + 0.21, 0.47, 0.92, cz2 - 0.22, cz2 - 0.19, stone);
    for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) {
      box(g, cx + lx - 0.015, cx + lx + 0.015, 0, 0.44, cz2 + lz - 0.015, cz2 + lz + 0.015, stone);
    }

    // --- Menuiserie : fenêtre à la française, deux vantaux à petits-bois ---
    const wood = paper(0xffffff);
    const fd = 0.06; // épaisseur
    const f = 0.055; // dormant
    box(g, -W / 2, -W / 2 + f, sill, top, -fd / 2, fd / 2, wood);
    box(g, W / 2 - f, W / 2, sill, top, -fd / 2, fd / 2, wood);
    box(g, -W / 2, W / 2, top - f, top, -fd / 2, fd / 2, wood);
    box(g, -W / 2, W / 2, sill, sill + (sill === 0 ? 0.1 : f), -fd / 2, fd / 2, wood);
    const leaves = W > 0.8 ? 2 : 1;
    const inW = W - 2 * f;
    const lw = inW / leaves;
    const y0 = sill + (sill === 0 ? 0.1 : f);
    const y1 = top - f;
    const of = 0.05; // ouvrant
    const diag = [];
    for (let i = 0; i < leaves; i++) {
      const x0 = -W / 2 + f + i * lw;
      const x1 = x0 + lw;
      box(g, x0, x0 + of, y0, y1, -fd / 2 + 0.005, fd / 2 - 0.005, wood);
      box(g, x1 - of, x1, y0, y1, -fd / 2 + 0.005, fd / 2 - 0.005, wood);
      box(g, x0, x1, y0, y0 + (sill === 0 ? 0.14 : of), -fd / 2 + 0.005, fd / 2 - 0.005, wood);
      box(g, x0, x1, y1 - of, y1, -fd / 2 + 0.005, fd / 2 - 0.005, wood);
      // petits-bois : carreaux d'environ 45 cm de haut
      const gy0 = y0 + (sill === 0 ? 0.14 : of);
      const gy1 = y1 - of;
      const n = Math.max(1, Math.round((gy1 - gy0) / 0.45));
      for (let k = 1; k < n; k++) {
        const y = gy0 + ((gy1 - gy0) * k) / n;
        box(g, x0 + of, x1 - of, y - 0.0125, y + 0.0125, -0.015, 0.015, wood);
      }
      // deux traits de reflet sur le vitrage, convention de dessin
      const px = x0 + of + 0.06;
      const py = gy1 - 0.08;
      diag.push(px, py - 0.12, 0.004, px + 0.12, py, 0.004, px, py - 0.22, 0.004, px + 0.2, py - 0.02, 0.004);
    }
    g.add(segments(diag, greyLine()));

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 2 * f, H - 2 * f),
      new THREE.MeshBasicMaterial({ color: 0xe8eef3, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide })
    );
    glass.position.set(0, sill + H / 2, 0);
    g.add(glass);

    // Garde-corps en ferronnerie devant une porte-fenêtre (non pris en compte dans le calcul)
    if (sill < 0.5) {
      const iron = paper(0xffffff);
      const zr = e - 0.025;
      const h = 1.0;
      box(g, -W / 2, W / 2, h - 0.03, h, zr - 0.015, zr + 0.015, iron, { cast: false, edges: true });
      box(g, -W / 2, W / 2, 0.08, 0.1, zr - 0.01, zr + 0.01, iron, { cast: false });
      const bars = [];
      for (let x = -W / 2 + 0.06; x < W / 2 - 0.03; x += 0.11) bars.push(x, 0.1, zr, x, h - 0.03, zr);
      g.add(segments(bars, lineMat()));
    }

    // --- Cotes en millimètres ---
    this.addDimensions(cfg);
    this.applyClip();
    this.applyHidden();
  }

  addDimensions(cfg) {
    const { W, H, e } = cfg;
    const sill = sillHeight(H);
    const top = sill + H;
    const g = this.building;
    const z = e + 0.04;
    const ext = [];
    // cote de largeur, au-dessus du chambranle
    const yd = top + 0.32;
    ext.push(-W / 2, yd, z, W / 2, yd, z);
    ext.push(-W / 2, yd - 0.06, z, -W / 2, yd + 0.06, z, W / 2, yd - 0.06, z, W / 2, yd + 0.06, z);
    // cote de hauteur, à gauche
    const xd = -W / 2 - 0.34;
    ext.push(xd, sill, z, xd, top, z);
    ext.push(xd - 0.06, sill, z, xd + 0.06, sill, z, xd - 0.06, top, z, xd + 0.06, top, z);
    g.add(segments(ext, lineMat()));
    const wl = textSprite(String(Math.round(W * 1000)));
    wl.position.set(0, yd + 0.13, z);
    g.add(wl);
    const hl = textSprite(String(Math.round(H * 1000)));
    hl.material.rotation = Math.PI / 2;
    hl.position.set(xd - 0.14, sill + H / 2, z);
    g.add(hl);
    if (e > 0.02) {
      const el = textSprite(String(Math.round(e * 1000)));
      el.position.set(W / 2 + 0.3, top + 0.06, e / 2);
      g.add(el);
    }
  }

  // ---------- Protections ----------

  setProtection(cfg) {
    disposeGroup(this.prot);
    const { W, H, e } = cfg;
    const sill = sillHeight(H);
    const fill = FILL[cfg.color] ?? 0xffffff;
    const mat = paper(fill);
    const zp = Math.max(0.02, e - 0.05);
    const d = Math.max(0, Math.min(1, cfg.deploy));
    const g = this.prot;
    const slats = (parent, x0, x1, yTop, height, z, slat, beta, thick = 0.006) => {
      const n = Math.round(height / slat.s);
      for (let i = 0; i < n; i++) {
        const m = box(parent, x0, x1, -thick / 2, thick / 2, -slat.w / 2, slat.w / 2, mat);
        m.position.set(0, yTop - (i + 0.5) * slat.s, z);
        m.rotation.x = (beta * Math.PI) / 180;
      }
    };
    const guides = (wd, depth) => {
      box(g, -W / 2, -W / 2 + wd, sill, sill + H, zp - depth / 2, zp + depth / 2, mat);
      box(g, W / 2 - wd, W / 2, sill, sill + H, zp - depth / 2, zp + depth / 2, mat);
    };

    switch (cfg.type) {
      case 'roulant': {
        const h = H * d;
        guides(0.03, 0.05);
        if (h > 0.005) {
          box(g, -W / 2 + 0.03, W / 2 - 0.03, sill + H - h, sill + H, zp - 0.007, zp + 0.007, mat);
          // lames du tablier
          const l = [];
          for (let y = sill + H - 0.055; y > sill + H - h; y -= 0.055) {
            l.push(-W / 2 + 0.03, y, zp + 0.008, W / 2 - 0.03, y, zp + 0.008);
          }
          g.add(segments(l, lineMat()));
        }
        break;
      }
      case 'screen': {
        const h = H * d;
        guides(0.03, 0.04);
        if (h > 0.005) {
          const fab = paper(fill === 0xffffff ? 0xe9e8e5 : fill, { transparent: true, opacity: 0.78 - cfg.openness / 40 });
          box(g, -W / 2 + 0.03, W / 2 - 0.03, sill + H - h, sill + H, zp - 0.0015, zp + 0.0015, fab);
          box(g, -W / 2 + 0.03, W / 2 - 0.03, sill + H - h, sill + H - h + 0.03, zp - 0.015, zp + 0.015, mat);
        }
        break;
      }
      case 'bso': {
        const h = H * d;
        guides(0.025, 0.04);
        if (h > 0.01) {
          const grp = new THREE.Group();
          g.add(grp);
          slats(grp, -W / 2 + 0.02, W / 2 - 0.02, sill + H, h, zp, BSO_SLAT, cfg.slatAngle);
        }
        break;
      }
      case 'accordeon': {
        const c = (W / 2) * d;
        for (const side of [-1, 1]) {
          const x0 = side < 0 ? -W / 2 : W / 2 - c;
          const x1 = side < 0 ? -W / 2 + c : W / 2;
          if (c > 0.02) {
            const panels = Math.max(1, Math.round(c / 0.18));
            for (let i = 0; i <= panels; i++) {
              const x = x0 + (i / panels) * (x1 - x0);
              box(g, x - 0.008, x + 0.008, sill, sill + H, zp - 0.015, zp + 0.015, mat);
            }
            if (cfg.louvered) {
              const grp = new THREE.Group();
              g.add(grp);
              slats(grp, x0, x1, sill + H, H, zp, PERSIENNE, PERSIENNE.beta, 0.004);
            } else {
              box(g, x0, x1, sill, sill + H, zp - 0.007, zp + 0.007, mat);
            }
          }
          const pack = 0.04 + 0.06 * (1 - d);
          if (d < 0.98) {
            const px = side < 0 ? -W / 2 + pack / 2 : W / 2 - pack / 2;
            box(g, px - pack / 2, px + pack / 2, sill, sill + H, zp - 0.025, zp + 0.025, mat);
          }
        }
        break;
      }
      case 'battants': {
        const L = W / 2;
        const a = (cfg.openAngle * Math.PI) / 180;
        for (const side of [-1, 1]) {
          const pivot = new THREE.Group();
          pivot.position.set((side * W) / 2, sill, e + 0.015);
          pivot.rotation.y = side < 0 ? -a : a;
          g.add(pivot);
          const dir = -side; // le vantail s'étend vers le centre quand il est fermé
          const xa = Math.min(0, dir * L);
          const xb = Math.max(0, dir * L);
          const st = 0.06;
          if (cfg.louvered) {
            box(pivot, xa, xa + st, 0, H, -0.015, 0.015, mat);
            box(pivot, xb - st, xb, 0, H, -0.015, 0.015, mat);
            box(pivot, xa, xb, 0, st, -0.015, 0.015, mat);
            box(pivot, xa, xb, H - st, H, -0.015, 0.015, mat);
            const n = Math.round((H - 2 * st) / PERSIENNE.s);
            for (let i = 0; i < n; i++) {
              const m = box(pivot, xa + st, xb - st, -0.0025, 0.0025, -PERSIENNE.w / 2, PERSIENNE.w / 2, mat);
              m.position.y = H - st - (i + 0.5) * PERSIENNE.s;
              m.rotation.x = (PERSIENNE.beta * Math.PI) / 180;
            }
          } else {
            box(pivot, xa, xb, 0, H, -0.015, 0.015, mat);
            // barres et écharpe en Z
            box(pivot, xa + 0.04, xb - 0.04, H * 0.18, H * 0.18 + 0.08, 0.015, 0.03, mat);
            box(pivot, xa + 0.04, xb - 0.04, H * 0.78, H * 0.78 + 0.08, 0.015, 0.03, mat);
          }
        }
        break;
      }
      case 'banne': {
        const P = cfg.bannePro * d;
        const margin = 0.3;
        const y = sill + H + 0.25;
        box(g, -W / 2 - margin, W / 2 + margin, y - 0.02, y + 0.12, e, e + 0.12, mat);
        if (P > 0.02) {
          const pivot = new THREE.Group();
          pivot.position.set(0, y, e);
          pivot.rotation.x = (cfg.banneAngle * Math.PI) / 180;
          g.add(pivot);
          box(pivot, -W / 2 - margin, W / 2 + margin, -0.004, 0.004, 0, P, mat);
          box(pivot, -W / 2 - margin, W / 2 + margin, -0.025, 0.025, P - 0.05, P, mat);
          // bandes de la toile
          const s = [];
          for (let x = -W / 2 - margin + 0.25; x < W / 2 + margin - 0.01; x += 0.25) s.push(x, 0.006, 0, x, 0.006, P);
          pivot.add(segments(s, lineMat()));
          // lambrequin
          box(pivot, -W / 2 - margin, W / 2 + margin, -0.2, 0, P - 0.003, P + 0.003, mat, { cast: false });
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
    const c = this.center;
    this.sun.target.position.set(0, 1, -1.5);
    this.sun.position.copy(this.sun.target.position).addScaledVector(v, 20);
    const up = Math.max(0, Math.min(1, sun.altitude / 8));
    this.sun.intensity = sun.altitude > 0 ? 2.4 * up : 0;
    this.ambient.intensity = sun.altitude > 0 ? AMBIENT : AMBIENT * 0.85;
    this.scene.background.set(sun.altitude > 0 ? 0xffffff : 0xf1f2f5);

    if (!this.sunMarker) {
      this.sunMarker = sunSprite();
      this.scene.add(this.sunMarker);
      this.ray = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineDashedMaterial({ color: INK, dashSize: 0.16, gapSize: 0.1 })
      );
      this.scene.add(this.ray);
    }
    const pos = c.clone().addScaledVector(v, DOME);
    this.sunMarker.position.copy(pos);
    this.sunMarker.visible = sun.altitude > -1;

    // Rayon en tirets : du soleil au centre de la baie, puis jusqu'au sol de la pièce
    const reaches = sun.altitude > 0 && s.z > 0.02;
    this.ray.visible = reaches;
    if (reaches) {
      const t = s.y > 0.02 ? Math.min(c.y / s.y, 12) : 12;
      const hit = c.clone().addScaledVector(v, -t);
      this.ray.geometry.dispose();
      this.ray.geometry = new THREE.BufferGeometry().setFromPoints([pos, hit]);
      this.ray.computeLineDistances();
    }
  }

  setPaths(paths, facadeAz) {
    disposeGroup(this.sunGroup);
    const c = this.center;
    for (const p of paths) {
      const pts = p.points
        .filter((q) => q.altitude > -2)
        .map((q) => {
          const s = sunVectorLocal(q.altitude, q.azimuth, facadeAz);
          return new THREE.Vector3(s.x, s.y, s.z).multiplyScalar(DOME).add(c);
        });
      if (pts.length < 2) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = p.dashed
        ? new THREE.LineDashedMaterial({ color: GREY, dashSize: 0.1, gapSize: 0.1 })
        : new THREE.LineBasicMaterial({ color: INK });
      const line = new THREE.Line(geo, mat);
      if (p.dashed) line.computeLineDistances();
      this.sunGroup.add(line);
    }
    // Horizon de la course solaire, en pointillé
    const ring = [];
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      ring.push(new THREE.Vector3(c.x + Math.sin(a) * DOME, c.y, c.z + Math.cos(a) * DOME));
    }
    const hor = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ring),
      new THREE.LineDashedMaterial({ color: GREY, dashSize: 0.06, gapSize: 0.12 })
    );
    hor.computeLineDistances();
    this.sunGroup.add(hor);
    this.setNorth(facadeAz);
  }

  setNorth(facadeAz) {
    if (this.northAz === facadeAz) return;
    this.northAz = facadeAz;
    disposeGroup(this.north);
    const n = sunVectorLocal(0, 0, facadeAz);
    const o = new THREE.Vector3(2.5, WALL_BOTTOM, 2.2);
    const r = 0.38;
    const circle = [];
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      circle.push(new THREE.Vector3(o.x + Math.cos(a) * r, o.y, o.z + Math.sin(a) * r));
    }
    this.north.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(circle), lineMat()));
    const tip = o.clone().add(new THREE.Vector3(n.x, 0, n.z).multiplyScalar(r + 0.18));
    const tail = o.clone().add(new THREE.Vector3(n.x, 0, n.z).multiplyScalar(-r));
    const side = new THREE.Vector3(-n.z, 0, n.x).multiplyScalar(0.12);
    const head = o.clone().add(new THREE.Vector3(n.x, 0, n.z).multiplyScalar(r - 0.12));
    const pts = [tail, tip, tip, head.clone().add(side), tip, head.clone().sub(side)];
    this.north.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat()));
    const lab = textSprite('N', 900);
    lab.position.copy(o.clone().add(new THREE.Vector3(n.x, 0, n.z).multiplyScalar(r + 0.42)));
    this.north.add(lab);
  }
}

// ---------- Utilitaires de dessin ----------

/** Boîte alignée (coordonnées min/max), cernée d'un trait noir. */
function box(parent, x0, x1, y0, y1, z0, z1, mat, { cast = true, edges = true } = {}) {
  const geo = new THREE.BoxGeometry(Math.max(1e-4, x1 - x0), Math.max(1e-4, y1 - y0), Math.max(1e-4, z1 - z0));
  const m = new THREE.Mesh(geo, mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = cast;
  m.receiveShadow = true;
  if (edges) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat()));
  parent.add(m);
  return m;
}

function segments(arr, mat) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  return new THREE.LineSegments(geo, mat);
}

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

function textSprite(text, weight = 400) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#111110';
  ctx.font = `${weight} 60px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(0.56, 0.21, 1);
  sp.renderOrder = 10;
  return sp;
}

function sunSprite() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#111110';
  ctx.lineWidth = 4;
  ctx.fillStyle = SUN_FILL;
  ctx.beginPath();
  ctx.arc(64, 64, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(a) * 36, 64 + Math.sin(a) * 36);
    ctx.lineTo(64 + Math.cos(a) * 52, 64 + Math.sin(a) * 52);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(0.55, 0.55, 1);
  sp.renderOrder = 11;
  return sp;
}
