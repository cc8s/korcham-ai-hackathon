import type { CSSProperties } from "react";
import { CHAR_ORDER, type CharId } from "../office/layout";

// 프로필 사진. chars.png (한 칸 24x30, 캐릭터당 2칸)에서 얼굴 부분만 잘라 보여 준다. 오디는 icons.png 의 로봇
export function Face(props: { who: CharId | "odi"; size?: number }) {
  const size = props.size ?? 36;
  if (props.who === "odi") {
    const style: CSSProperties = { width: size, height: size, backgroundSize: `auto ${size}px`, backgroundPosition: `-${size}px 0` };
    return <span className="face odi" style={style} />;
  }
  const k = size / 24; // 칸 폭 24px 을 size 에 맞춤 → 위쪽 24px(머리)만 보인다
  const i = CHAR_ORDER.indexOf(props.who);
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundSize: `${240 * k}px ${30 * k}px`,
    backgroundPosition: `-${i * 2 * 24 * k}px ${-1 * k}px`,
  };
  return <span className="face" style={style} />;
}
