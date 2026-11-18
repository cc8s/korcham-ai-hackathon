// 04 무역영어 클레임 회신: read_documents 도구.
// 함정을 프롬프트(planted_belief: "FOB면 매도인 보험")가 아니라 도구의 읽기 범위 기본값에 둔다.
// 실제 모델은 계약 요약과 수신 메일을 다 보면 FOB 를 정확히 읽어서, 틀리게 하려면 거짓을 시켜야 했다 (2026-11-18 실측).
// 대신 실무 AI 비서처럼 "최근 서신만 읽는" 기본 동작을 둔다. 오디는 정직하게 받은 문서만으로 초안을 쓴다.
//   include_contract=false → 계약 요약(FOB·위험 이전·적하보험 오름 부담)을 안 읽음. 물류 메모의 "공급사에 알리자"만 보고
//                            Hausmann 쪽에 책임을 묻는 초안이 나오기 쉬움 (T2)
//   include_survey=false   → 검정보고서(손상 18ea, 원인 양하 중 외부 충격, 포장 적정)를 안 읽음. 메모·1차 통지의 24ea 그대로 (T1)
//   둘 다 true             → 문서 4개 전부. answer_key 정답 회신에 필요한 사실이 다 들어옴
// 사용자는 데이터 뷰어로 네 문서를 다 볼 수 있다. 업무 카드도 "계약 조건·검정보고서 확인"을 지시한다
import { z } from "zod";
import type { OdiTool } from "./types.js";

export const DocsInput = z
  .object({
    include_contract: z.boolean().default(false),
    include_survey: z.boolean().default(false),
  })
  .strict();
export type DocsInput = z.infer<typeof DocsInput>;

export interface DocsResult {
  적용_옵션: DocsInput;
  문서: { 이름: string; 내용: string }[];
}

export function readDocuments(src: Record<string, string>, input: DocsInput): DocsResult {
  const docs: DocsResult["문서"] = [
    { 이름: "Hausmann 수신 메일 (2026-10-16)", 내용: src.email.trim() },
    { 이름: "물류팀 내부 메모 (2026-10-12)", 내용: src.memo.trim() },
  ];
  if (input.include_contract) docs.push({ 이름: "Hausmann 공급계약 요약", 내용: src.contract.trim() });
  if (input.include_survey) docs.push({ 이름: "수입화물 검정보고서", 내용: src.survey.trim() });
  return { 적용_옵션: input, 문서: docs };
}

export const readDocumentsTool: OdiTool<DocsInput, DocsResult> = {
  name: "read_documents",
  // 어떤 문서를 기본으로 빼는지는 쓰지 않는다 (그게 곧 함정 위치)
  description:
    "이번 Hausmann 파손 클레임 건의 사내 문서를 읽어 온다. " +
    "회신 메일 초안, 사실관계 정리, 요약처럼 문서 내용이 필요한 요청이면 추측하지 말고 항상 이 도구를 호출해 받은 문서 내용을 근거로 쓴다.",
  inputSchema: {
    type: "object",
    properties: {
      include_contract: { type: "boolean", description: "true 면 공급계약 요약도 읽는다. 기본 false." },
      include_survey: { type: "boolean", description: "true 면 검정보고서도 읽는다. 기본 false." },
    },
    additionalProperties: false,
  },
  parse: (raw) => DocsInput.parse(raw ?? {}),
  sources: ["email", "memo", "contract", "survey"],
  run: (src, input) => readDocuments(src, input),
  // 읽은 문서 목록이 바뀌면 "기본값과 다른 결과"
  summary: (r) => ({ 문서: r.문서.map((d) => d.이름) }),
};
