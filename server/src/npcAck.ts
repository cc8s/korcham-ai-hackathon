// 맞장구 메시지("넵", "네 알겠습니다" 등)는 팀원 AI 를 부르지 않고 고정 답으로 받는다.
// 발견: "넵"만 반복해도 팀원이 매번 말을 덧붙이다 "원본 행 수와 집계 행 수 비교", "시각 열의 시간대 표시"처럼
// 함정 해법을 구체적으로 말했다 (실측 "넵" 80회 중 확인 항목 11회, server/test/npc_leak.mjs).
// 고정 답은 매번 같고, 비용 0, 샐 수 없다 (이하늘 인사·팀장 지시를 고정 대사로 둔 것과 같은 원칙).
import type { NpcId } from "./scenarios.js";

const ACK_WORD = "(?:넵넵|넵|네네|네|넹|예|옙|응|ㅇㅇ|ㅇㅋ|ㅇㅋㅇㅋ|오케이|ok|okay|알겠습니다|알겠어요|알겠어|알겠슴다|알겠당|확인했습니다|확인했어요|확인|감사합니다|감사해요|고맙습니다|고마워요|좋아요|좋습니다|넵 알겠습니다)";
// 맞장구 낱말들만 (사이에 공백·쉼표, 끝에 ! . ~ ㅎ ㅋ ^ 등) 있으면 맞장구. 질문·내용이 섞이면 아님
const ACK_RE = new RegExp(`^\\s*${ACK_WORD}(?:[\\s,]+${ACK_WORD})*[\\s.!~ㅎㅋ^;:)]*$`, "i");

export function isAck(message: string): boolean {
  return message.length <= 30 && ACK_RE.test(message.trim());
}

// 팀원 성격에 맞춘 짧은 답. 새 당부를 덧붙이지 않는다
export const ACK_REPLY: Record<NpcId, string> = {
  kang: "네, 진행하다 막히면 물어보세요.",
  park: "네, 부탁해요.",
  jung: "네, 진행해 주세요.",
  lee: "좋아요! 막히면 언제든 불러요.",
};
