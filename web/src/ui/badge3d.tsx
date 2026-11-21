// 3D 사원증 (입장·온보딩). Vercel "interactive 3D event badge" 구조:
//   고정점 → 관절1 → 관절2 → 관절3 (rope joint) → 카드 (spherical joint), 물리는 rapier
// - 카드를 잡은 지점 기준으로 끌고, 놓으면 끌던 속도 그대로 날아가 진자처럼 흔들리다 멈춘다. 뒤집힘도 물리 결과로만
// - 끈은 meshline 대신 직접 만든 띠: meshline 은 항상 화면을 향해 카드가 돌아도 꼬임이 안 보여서
// - 카드가 몇 바퀴 돌았는지 누적(twist)해 끈을 그만큼 꼬고, 멈출 때는 그 바퀴 수만큼 거꾸로 풀며 앞면으로 돌아온다
// - 재질: 직접 계산하는 조명 셰이더(litMaterial). three 기본 조명 재질은 이 화면에서 파랑이 연하게 떠서
//   (#3541EF → 약 #6070FF 로 측정) 이미지 색은 그대로 읽고 명암·반사·천 결만 계산해 곱하고 더한다
//   정면 밝기는 디자이너 예시 캡처(흰 면 약 229,230,241 = Figma 242,242,255 의 약 94%)에 맞춤
import * as THREE from "three";
import { Canvas, useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  BallCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  useRopeJoint,
  useSphericalJoint,
  type RapierRigidBody,
  type RigidBodyProps,
} from "@react-three/rapier";
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from "react";

// ▼ 조절값
const TUNE = {
  gravity: -40, // 중력
  damping: 2, // 끈·카드 감쇠 (클수록 빨리 멈춤)
  unwind: 0.12, // 돌아간 만큼 되돌리는 힘 (Vercel 예제 ang.y - rot.y * 0.25 에 해당)
  unwindMax: 0.5, // 한 프레임에 되돌리는 최대 각속도
  brush: 0.5, // 마우스가 카드를 스칠 때 미는 세기 (0 = 끔)
  follow: 0.02, // 마우스 쪽으로 몸을 트는 세기 (0 = 끔)
  followHold: 1.0, // 마우스가 멈춘 뒤 그쪽을 계속 보는 시간(초)
  followFade: 1.2, // 그 뒤 원래대로 돌아오는 데 걸리는 시간(초)
  // 재질: ambient + diffuse × (빛을 향한 정도) 가 밝기, spec 은 반사광 세기, shine 은 반사 크기(클수록 작고 또렷)
  // 무광 카드 + 진주 같은 약한 프리즘 반사광 (pearl: 0 = 끔, 0.04 ~ 0.12)
  card: { ambient: 0.48, diffuse: 0.42, spec: 0.24, shine: 18, rim: 0, pearl: 0.09 },
  edge: { ambient: 0.55, diffuse: 0.45, spec: 0.15, shine: 20, rim: 0 },
  band: { ambient: 0.5, diffuse: 0.45, spec: 0.3, shine: 60, rim: 0, weave: 0.16 }, // 실크 광택(꼬이거나 기울 때 지나감) + 천 결
  clip: { ambient: 0.35, diffuse: 0.35, spec: 1.1, shine: 60, rim: 0.7 }, // 진회색 금속, 테두리만 반짝
  ring: { ambient: 0.55, diffuse: 0.4, spec: 1.2, shine: 50, rim: 0.5 }, // 은색 고리
};

// 크기 (월드 단위). 카드는 화면 세로의 약 60%, 카드 윗변은 위에서 29% (디자이너 예시)
const FOV = 25;
const CARD_W = 1.6;
const CARD_H = (CARD_W * 1440) / 1024; // Figma 앞·뒤 1024×1440
const VIEW_H = CARD_H / 0.6;
const CAM_Z = VIEW_H / 2 / Math.tan(((FOV / 2) * Math.PI) / 180);
const CARD_T = 0.035; // 두께 (옆면 흰 테두리가 보이게)
const CARD_R = CARD_W * 0.06; // 모서리 반경
const SLOT_W = 0.34;
const SLOT_H = 0.08;
const SLOT_Y = CARD_H / 2 - 0.12;
const JOINT_Y = CARD_H / 2 + 0.33; // 카드 중심에서 끈 끝(클립 위)까지
const CLIP = { y: CARD_H / 2 + 0.235, w: 0.3, h: 0.17, d: 0.05 };
const RING = { y: CARD_H / 2 + 0.03, r: 0.1, tube: 0.014 };
const BAND_W = CARD_W * 0.15;
const ANCHOR_AT = 0.738; // 끈 위 끝의 가로 위치 (화면 폭 비율, Figma)
const ANCHOR_Y = VIEW_H / 2 + 0.3; // 화면 맨 위 바로 바깥
const CARD_TOP_Y = VIEW_H * (0.5 - 0.29);
const SEG_LEN = (ANCHOR_Y - (CARD_TOP_Y + JOINT_Y - CARD_H / 2)) / 3; // 늘어졌을 때 카드 윗변이 29% 에 오게
const LIGHT_POS = new THREE.Vector3(-1.5, 3.5, 7); // 왼쪽 위 앞 (예시처럼 왼쪽 위가 밝게)

// ---------- 조명 셰이더 ----------
const litVert = /* glsl */ `
  attribute vec3 tangent3;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vT;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vT = mat3(modelMatrix) * tangent3;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const litFrag = /* glsl */ `
  uniform sampler2D map; uniform float useMap; uniform vec3 color;
  uniform vec3 lightPos; uniform float ambient; uniform float diffuse; uniform float spec; uniform float shine;
  uniform float rim; uniform float weave; uniform vec2 weaveScale;
  uniform float pearl;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP; varying vec3 vT;
  void main() {
    vec3 base = useMap > 0.5 ? texture2D(map, vUv).rgb : color; // sRGB 텍스처는 여기서 이미 선형값
    vec3 V = normalize(cameraPosition - vP);
    vec3 N = normalize(vN);
    if (dot(N, V) < 0.0) N = -N; // 양면(끈): 보는 쪽을 향하게
    vec3 L = normalize(lightPos - vP);
    vec3 H = normalize(L + V);
    float ndl = max(dot(N, L), 0.0);
    float shade = ambient + diffuse * ndl;
    float s;
    if (length(vT) > 0.5) {
      // 실크: 결(끈 길이) 방향으로 길게 늘어진 광택
      float th = dot(normalize(vT), H);
      s = pow(sqrt(max(0.0, 1.0 - th * th)), shine) * ndl;
    } else {
      s = pow(max(dot(N, H), 0.0), shine);
    }
    if (weave > 0.0) {
      // 천 결: 가로·세로로 촘촘한 격자
      vec2 g = vUv * weaveScale;
      float m = (0.5 + 0.5 * sin(g.x * 6.2832)) * (0.5 + 0.5 * sin(g.y * 6.2832));
      shade *= 1.0 - weave + weave * (0.6 + 0.8 * m);
    }
    float r = pow(1.0 - max(dot(N, V), 0.0), 3.0) * rim;
    vec3 col = base * shade + vec3(s * spec + r);
    if (pearl > 0.0) {
      // 진주 같은 약한 프리즘: 빛을 받는 넓은 영역(lobe)과 비스듬한 가장자리에 무지갯빛이 얇게 돈다.
      // 색이 각도·위치에 따라 바뀌어서 기울이면 무지개 띠가 카드 위를 지나간다
      float f = 1.0 - max(dot(N, V), 0.0);
      float lobe = pow(max(dot(N, H), 0.0), 12.0);
      float hue = dot(N, H) * 2.2 + (vP.x - vP.y) * 0.35;
      vec3 irid = 0.5 + 0.5 * cos(6.2832 * (hue + vec3(0.0, 0.33, 0.67)));
      col += irid * pearl * (lobe + 1.2 * f * f);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

type LitOpts = { ambient: number; diffuse: number; spec: number; shine: number; rim: number; weave?: number; pearl?: number };
function litMaterial(o: LitOpts, src: { map?: THREE.Texture; color?: number }, extra: { side?: THREE.Side; weaveScale?: [number, number] } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: litVert,
    fragmentShader: litFrag,
    side: extra.side ?? THREE.FrontSide,
    uniforms: {
      map: { value: src.map ?? null },
      useMap: { value: src.map ? 1 : 0 },
      color: { value: new THREE.Color(src.color ?? 0xffffff) },
      lightPos: { value: LIGHT_POS },
      ambient: { value: o.ambient },
      diffuse: { value: o.diffuse },
      spec: { value: o.spec },
      shine: { value: o.shine },
      rim: { value: o.rim },
      weave: { value: o.weave ?? 0 },
      pearl: { value: o.pearl ?? 0 },
      weaveScale: { value: new THREE.Vector2(...(extra.weaveScale ?? [1, 1])) },
    },
  });
}

// ---------- 모양 ----------
function roundedRect(path: THREE.Path, x: number, y: number, w: number, h: number, r: number) {
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.quadraticCurveTo(x + w, y, x + w, y + r);
  path.lineTo(x + w, y + h - r);
  path.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  path.lineTo(x + r, y + h);
  path.quadraticCurveTo(x, y + h, x, y + h - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
}
function cardShape() {
  const s = new THREE.Shape();
  roundedRect(s, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, CARD_R);
  const hole = new THREE.Path();
  roundedRect(hole, -SLOT_W / 2, SLOT_Y - SLOT_H / 2, SLOT_W, SLOT_H, SLOT_H / 2 - 0.001);
  s.holes.push(hole);
  return s;
}
// 셰이더가 tangent3 를 읽으므로 끈 말고는 0 을 채워 둔다 (0 이면 실크 광택 대신 일반 반사)
function withTangent(g: THREE.BufferGeometry) {
  if (!g.getAttribute("tangent3")) g.setAttribute("tangent3", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
  return g;
}

function useCardParts() {
  return useMemo(() => {
    const face = new THREE.ShapeGeometry(cardShape(), 16);
    const pos = face.attributes.position;
    const uv = face.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + CARD_W / 2) / CARD_W, (pos.getY(i) + CARD_H / 2) / CARD_H);
    const edge = new THREE.ExtrudeGeometry(cardShape(), { depth: CARD_T, bevelEnabled: false, curveSegments: 16 });
    edge.translate(0, 0, -CARD_T / 2);
    // 클립: 모서리가 둥글고 테두리가 살짝 깎인 금속 블록
    const cs = new THREE.Shape();
    roundedRect(cs, -CLIP.w / 2, -CLIP.h / 2, CLIP.w, CLIP.h, 0.035);
    const clip = new THREE.ExtrudeGeometry(cs, { depth: CLIP.d, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 4, curveSegments: 8 });
    clip.translate(0, 0, -CLIP.d / 2);
    const ring = new THREE.TorusGeometry(RING.r, RING.tube, 12, 40);
    return { face: withTangent(face), edge: withTangent(edge), clip: withTangent(clip), ring: withTangent(ring) };
  }, []);
}

// ---------- 끈 띠 ----------
const BAND_STEPS = 48;
const BAND_TILE = BAND_W * (1152 / 192); // 밴드 줄 이미지 한 장이 덮는 길이
function useBandGeometry() {
  return useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = (BAND_STEPS + 1) * 2;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("tangent3", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const idx: number[] = [];
    for (let i = 0; i < BAND_STEPS; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    return g;
  }, []);
}

type Joint = RapierRigidBody;

function Lanyard({ reducedMotion }: { reducedMotion: boolean }) {
  const [frontTex, backTex, bandTex] = useLoader(THREE.TextureLoader, [
    "/assets/badge3d/front.webp",
    "/assets/badge3d/back.webp",
    "/assets/badge3d/band.png",
  ]);
  const gl = useThree((s) => s.gl);
  useMemo(() => {
    for (const t of [frontTex, backTex, bandTex]) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = gl.capabilities.getMaxAnisotropy();
    }
    bandTex.wrapS = THREE.ClampToEdgeWrapping; // 로고는 클립 위 한 번만, 나머지는 이미지 왼쪽 끝 색(파랑)으로 채움
  }, [frontTex, backTex, bandTex, gl]);

  const parts = useCardParts();
  const bandGeo = useBandGeometry();
  const mats = useMemo(
    () => ({
      front: litMaterial(TUNE.card, { map: frontTex }),
      back: litMaterial(TUNE.card, { map: backTex }),
      edge: litMaterial(TUNE.edge, { color: 0xf2f3fa }),
      clip: litMaterial(TUNE.clip, { color: 0x4a4c54 }),
      ring: litMaterial(TUNE.ring, { color: 0xaeb2ba }),
      // 천 결: 끈 폭에 약 16칸
      band: litMaterial(TUNE.band, { map: bandTex }, { side: THREE.DoubleSide, weaveScale: [(BAND_TILE / BAND_W) * 16, 16] }),
    }),
    [frontTex, backTex, bandTex],
  );

  const fixed = useRef<Joint>(null) as RefObject<Joint>;
  const j1 = useRef<Joint>(null) as RefObject<Joint>;
  const j2 = useRef<Joint>(null) as RefObject<Joint>;
  const j3 = useRef<Joint>(null) as RefObject<Joint>;
  const card = useRef<RapierRigidBody>(null) as RefObject<RapierRigidBody>;
  const L = SEG_LEN;
  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], L]);
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], L]);
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], L]);
  useSphericalJoint(j3, card, [[0, 0, 0], [0, JOINT_Y, 0]]);

  const [dragged, setDragged] = useState<THREE.Vector3 | null>(null);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!hovered && !dragged) return;
    document.body.style.cursor = dragged ? "grabbing" : "grab";
    return () => void (document.body.style.cursor = "");
  }, [hovered, dragged]);

  // 끈 위 끝: 화면 맨 위 바로 바깥, 가로 73.8%
  const viewport = useThree((s) => s.viewport);
  const anchor = useMemo(() => new THREE.Vector3((ANCHOR_AT - 0.5) * viewport.width, ANCHOR_Y, 0), [viewport.width]);
  const [start] = useState(() => anchor.clone()); // 처음 생성 위치 (그 뒤 창 크기가 바뀌면 고정점만 옮긴다)
  useEffect(() => {
    fixed.current?.setTranslation(anchor, true);
  }, [anchor, fixed]);

  const tmp = useMemo(
    () => ({
      vec: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      fwd: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      t: new THREE.Vector3(),
      side: new THREE.Vector3(),
      nrm: new THREE.Vector3(),
      twistQ: new THREE.Quaternion(),
    }),
    [],
  );
  const twist = useRef({ acc: 0, prev: 0 });
  const look = useRef({ x: 0, y: 0, t: 0 }); // 마지막으로 마우스가 움직인 위치·시각

  useFrame((state, delta) => {
    const { vec, dir } = tmp;
    if (!fixed.current || !j1.current || !j2.current || !j3.current || !card.current) return;
    if (dragged) {
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
      dir.copy(vec).sub(state.camera.position).normalize();
      vec.add(dir.multiplyScalar(state.camera.position.length()));
      [card, j1, j2, j3, fixed].forEach((r) => r.current?.wakeUp());
      card.current.setNextKinematicTranslation({ x: vec.x - dragged.x, y: vec.y - dragged.y, z: vec.z - dragged.z });
    }
    // 카드가 Y축으로 몇 바퀴 돌았는지 누적 → 끈 꼬임, 그리고 그만큼 거꾸로 풀며 앞면으로
    const r = card.current.rotation();
    tmp.q.set(r.x, r.y, r.z, r.w);
    tmp.fwd.set(0, 0, 1).applyQuaternion(tmp.q);
    const yaw = Math.atan2(tmp.fwd.x, tmp.fwd.z);
    let d = yaw - twist.current.prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    twist.current.acc += d;
    twist.current.prev = yaw;
    if (!dragged) {
      const a = card.current.angvel();
      const k = Math.max(-TUNE.unwindMax, Math.min(TUNE.unwindMax, twist.current.acc * TUNE.unwind * delta * 60));
      // 마우스 쪽으로 살짝 돌아봄: 커서가 왼쪽이면 앞면이 왼쪽을 향하게 (앞면 복원 힘과 맞서 조금만 돈다)
      let fy = 0;
      let fx = 0;
      if (!reducedMotion && TUNE.follow > 0) {
        const c = card.current.translation();
        const px = (state.pointer.x * state.viewport.width) / 2;
        const py = (state.pointer.y * state.viewport.height) / 2;
        // 마우스가 멈추면 followHold 초 동안 유지, 그 뒤 followFade 초에 걸쳐 힘이 0 으로 → 앞면 복원 힘에 의해 원상태로
        const now = state.clock.elapsedTime;
        if (state.pointer.x !== look.current.x || state.pointer.y !== look.current.y) {
          look.current = { x: state.pointer.x, y: state.pointer.y, t: now };
        }
        const idle = now - look.current.t - TUNE.followHold;
        const keep = idle <= 0 ? 1 : Math.max(0, 1 - idle / TUNE.followFade);
        const sc = TUNE.follow * delta * 60 * keep;
        fy = THREE.MathUtils.clamp((px - c.x) * sc, -0.05, 0.05);
        fx = THREE.MathUtils.clamp(-(py - c.y) * sc * 0.5, -0.03, 0.03);
      }
      card.current.setAngvel({ x: a.x + fx, y: a.y - k + fy, z: a.z }, true);
    }

  });

  // 끈 띠는 그리기 직전에 계산한다: 물리 엔진이 보간(interpolate)해 그린 카드·관절 위치를 써야
  // 빨리 움직일 때 끈 끝과 클립이 어긋나지 않는다 (물리 계산값 translation() 은 화면보다 한 박자 다름)
  const bandMesh = useRef<THREE.Mesh>(null);
  const vis = {
    fixed: useRef<THREE.Group>(null),
    j1: useRef<THREE.Group>(null),
    j2: useRef<THREE.Group>(null),
    clipTop: useRef<THREE.Group>(null),
  };
  const lerped = useMemo(() => ({ j1: new THREE.Vector3(), j2: new THREE.Vector3(), init: false, last: 0 }), []);
  const bp = useMemo(
    () => ({ p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), up: new THREE.Vector3(), cardX: new THREE.Vector3(), end: new THREE.Vector3() }),
    [],
  );
  const curve5 = useMemo(() => new THREE.CatmullRomCurve3(Array.from({ length: 5 }, () => new THREE.Vector3())), []);
  useEffect(() => {
    const mesh = bandMesh.current;
    if (!mesh) return;
    mesh.onBeforeRender = () => {
      const f = vis.fixed.current, a = vis.j1.current, b = vis.j2.current, ct = vis.clipTop.current;
      if (!f || !a || !b || !ct) return;
      f.getWorldPosition(bp.p0);
      a.getWorldPosition(bp.p1);
      b.getWorldPosition(bp.p2);
      // 세게 당겼을 때 끈이 떨리는 것 줄이기 (Vercel 예제의 lerp)
      const now = performance.now();
      const dt = lerped.init ? Math.min(0.05, (now - lerped.last) / 1000) : 1;
      lerped.last = now;
      if (!lerped.init) {
        lerped.j1.copy(bp.p1);
        lerped.j2.copy(bp.p2);
        lerped.init = true;
      }
      for (const [l, p] of [[lerped.j1, bp.p1], [lerped.j2, bp.p2]] as const) {
        const d = Math.max(0.1, Math.min(1, l.distanceTo(p)));
        l.lerp(p, Math.min(1, dt * (10 + d * 40)));
      }
      // 끈 끝 = 그려진 클립 윗면. 그 조금 위 점을 하나 더 둬서 클립에 곧게 들어가되, 위쪽은 관절이라 꺾이는 유격이 남는다
      ct.getWorldPosition(bp.end);
      bp.up.set(0, 1, 0).transformDirection(ct.matrixWorld);
      bp.cardX.set(1, 0, 0).transformDirection(ct.matrixWorld);
      curve5.points[0].copy(bp.p0);
      curve5.points[1].copy(lerped.j1);
      curve5.points[2].copy(lerped.j2);
      curve5.points[3].copy(bp.end).addScaledVector(bp.up, 0.12);
      curve5.points[4].copy(bp.end);
      curve5.updateArcLengths(); // 점이 움직였으니 길이 캐시를 다시 계산 (안 하면 처음 길이로 무늬가 눌림)
      buildBand(curve5, bp.cardX);
    };
  });

  const buildBand = (curve: THREE.CatmullRomCurve3, cardX: THREE.Vector3) => {
    const pos = bandGeo.attributes.position as THREE.BufferAttribute;
    const nor = bandGeo.attributes.normal as THREE.BufferAttribute;
    const tan = bandGeo.attributes.tangent3 as THREE.BufferAttribute;
    const uv = bandGeo.attributes.uv as THREE.BufferAttribute;
    const total = curve.getLength();
    for (let i = 0; i <= BAND_STEPS; i++) {
      const s = i / BAND_STEPS;
      const c = curve.getPointAt(s);
      curve.getTangentAt(s, tmp.t);
      tmp.side.set(0, 0, 1).cross(tmp.t).normalize(); // 화면과 나란한 폭 방향
      tmp.twistQ.setFromAxisAngle(tmp.t, -twist.current.acc * s); // 카드가 도는 방향과 같게
      tmp.side.applyQuaternion(tmp.twistQ);
      if (s > 0.8) {
        // 클립 근처: 띠 폭 방향을 카드 가로축에 맞춰 클립에 딱 붙게
        tmp.nrm.copy(cardX).addScaledVector(tmp.t, -cardX.dot(tmp.t)).normalize();
        if (tmp.nrm.dot(tmp.side) < 0) tmp.nrm.negate();
        tmp.side.lerp(tmp.nrm, THREE.MathUtils.smoothstep(s, 0.8, 1)).normalize();
      }
      tmp.nrm.crossVectors(tmp.t, tmp.side).normalize();
      for (const k of [0, 1]) {
        nor.setXYZ(i * 2 + k, tmp.nrm.x, tmp.nrm.y, tmp.nrm.z);
        // 광택 결 = 폭 방향: 정면에선 거의 안 보이고, 꼬이거나 기울 때 띠를 가로질러 지나감
        tan.setXYZ(i * 2 + k, tmp.side.x, tmp.side.y, tmp.side.z);
      }
      tmp.side.multiplyScalar(BAND_W / 2);
      pos.setXYZ(i * 2, c.x - tmp.side.x, c.y - tmp.side.y, c.z - tmp.side.z);
      pos.setXYZ(i * 2 + 1, c.x + tmp.side.x, c.y + tmp.side.y, c.z + tmp.side.z);
      const u = 1 - (total * (1 - s)) / BAND_TILE; // 로고가 클립 바로 위에 오도록 아래 끝 기준
      uv.setXY(i * 2, u, 0);
      uv.setXY(i * 2 + 1, u, 1);
    }
    pos.needsUpdate = nor.needsUpdate = tan.needsUpdate = uv.needsUpdate = true;
  };

  const seg: RigidBodyProps = { type: "dynamic", canSleep: true, colliders: false, angularDamping: TUNE.damping, linearDamping: TUNE.damping };
  // 처음 자리: 옆으로 뻗어 있다가 떨어지며 흔들림 (Vercel 예제). 움직임 줄이기 설정이면 처음부터 늘어진 채로
  const at = (i: number): [number, number, number] =>
    reducedMotion ? [start.x, start.y - i * L, 0] : [start.x + i * L, start.y, 0];
  const cardAt: [number, number, number] = reducedMotion ? [start.x, start.y - 3 * L - JOINT_Y, 0] : [start.x + 4 * L, start.y, 0];

  const down = (e: ThreeEvent<PointerEvent>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = card.current!.translation();
    setDragged(new THREE.Vector3().copy(e.point).sub(new THREE.Vector3(p.x, p.y, p.z)));
  };
  // 스치면 흔들림: 카드 위를 지나간 만큼 그 지점을 민다 (중심에서 벗어나 밀면 기울거나 돈다)
  const lastHit = useRef<THREE.Vector3 | null>(null);
  const brush = (e: ThreeEvent<PointerEvent>) => {
    if (dragged || reducedMotion || TUNE.brush <= 0 || !card.current) return;
    const p = e.point.clone();
    const prev = lastHit.current;
    lastHit.current = p;
    if (!prev) return;
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) return; // 튀는 값 무시
    const m = card.current.mass();
    card.current.applyImpulseAtPoint({ x: dx * TUNE.brush * m * 10, y: dy * TUNE.brush * m * 4, z: 0 }, p, true);
  };
  const up = (e: ThreeEvent<PointerEvent>) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    setDragged(null);
  };

  return (
    <>
      <RigidBody ref={fixed} {...seg} type="fixed" position={at(0)}>
        <group ref={vis.fixed} />
      </RigidBody>
      <RigidBody ref={j1} {...seg} position={at(1)}>
        <BallCollider args={[0.1]} />
        <group ref={vis.j1} />
      </RigidBody>
      <RigidBody ref={j2} {...seg} position={at(2)}>
        <BallCollider args={[0.1]} />
        <group ref={vis.j2} />
      </RigidBody>
      <RigidBody ref={j3} {...seg} position={at(3)}>
        <BallCollider args={[0.1]} />
      </RigidBody>
      <RigidBody ref={card} {...seg} position={cardAt} type={dragged ? "kinematicPosition" : "dynamic"}>
        <CuboidCollider args={[CARD_W / 2, CARD_H / 2, CARD_T / 2]} />
        <group
          onPointerOver={() => setHovered(true)}
          onPointerOut={() => {
            setHovered(false);
            lastHit.current = null;
          }}
          onPointerMove={brush}
          onPointerDown={down}
          onPointerUp={up}
        >
          <mesh geometry={parts.face} material={mats.front} position={[0, 0, CARD_T / 2 + 0.001]} />
          <mesh geometry={parts.face} material={mats.back} position={[0, 0, -CARD_T / 2 - 0.001]} rotation={[0, Math.PI, 0]} />
          <mesh geometry={parts.edge} material={mats.edge} />
          <mesh geometry={parts.clip} material={mats.clip} position={[0, CLIP.y, 0]} />
          <mesh geometry={parts.ring} material={mats.ring} position={[0, RING.y, 0]} rotation={[0, Math.PI / 2, 0]} />
          <group ref={vis.clipTop} position={[0, CLIP.y + CLIP.h / 2 - 0.02, 0]} />
        </group>
      </RigidBody>
      <mesh ref={bandMesh} geometry={bandGeo} material={mats.band} frustumCulled={false} />
    </>
  );
}

export default function Badge3D({ reducedMotion, eventSource, fallback }: { reducedMotion: boolean; eventSource: HTMLElement; fallback: React.ReactNode }) {
  return (
    <Canvas
      flat // 톤 매핑 끔: 색은 litMaterial 이 직접 계산
      dpr={[1, 2]}
      camera={{ position: [0, 0, CAM_Z], fov: FOV }}
      gl={{ alpha: true, antialias: true }}
      eventSource={eventSource}
      eventPrefix="client"
      fallback={fallback}
    >
      <Suspense fallback={null}>
        <Physics gravity={[0, TUNE.gravity, 0]} timeStep={1 / 60} interpolate>
          <Lanyard reducedMotion={reducedMotion} />
        </Physics>
      </Suspense>
    </Canvas>
  );
}
