import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";

// 입장·온보딩 3D 사원증 (Figma 앞·뒤·밴드 줄). three.js·rapier 는 이 화면에서만 따로 불러온다 (./badge3d)
// 캔버스는 창 전체를 덮지만 마우스 이벤트는 #root 에서 받아(캔버스 자체는 클릭을 통과) 입사 폼·헤더를 막지 않는다
// WebGL 을 못 쓰거나 불러오기에 실패하면 앞면 이미지 한 장을 보여 준다
const Badge3D = lazy(() => import("./badge3d"));

const still = <img className="sk-badge3d-still" src="/assets/badge3d/front.webp" alt="" draggable={false} />;

class Fallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? still : this.props.children;
  }
}

export function Badge() {
  // 아주 좁은 화면(560px 이하)에선 그리지 않는다
  const [show] = useState(() => !window.matchMedia("(max-width: 560px)").matches);
  const [reducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => setRoot(document.getElementById("root")), []);
  if (!show || !root) return null;
  return (
    <div className="sk-badge3d" aria-hidden="true">
      <Fallback>
        <Suspense fallback={null}>
          <Badge3D reducedMotion={reducedMotion} eventSource={root} fallback={still} />
        </Suspense>
      </Fallback>
    </div>
  );
}

// Simtern 헤더 (입장·온보딩)
export function SimternTop() {
  return (
    <header className="sk-top">
      <img src="/assets/ui/simtern-logo.svg" width={162} height={41} alt="Simtern" />
    </header>
  );
}
