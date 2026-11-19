// 입장·온보딩 오른쪽 사원증. 들어올 때 위에서 떨어져 줄 끝을 축으로 몇 번 흔들리다 멈춘다 (CSS: .sk-badge*)
// 마우스를 올리면 한 번 더 살짝 흔들린다. prefers-reduced-motion 이면 움직이지 않는다
export function Badge() {
  return (
    <div className="sk-badge-wrap" aria-hidden="true">
      <div className="sk-badge-drop">
        <div className="sk-badge-swing">
          <img className="sk-badge" src="/assets/ui/badge.png" alt="" draggable={false} />
        </div>
      </div>
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
