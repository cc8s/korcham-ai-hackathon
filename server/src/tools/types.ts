import type Anthropic from "@anthropic-ai/sdk";

// 오디 계산 도구 한 개. 함정은 parse 의 기본값(전부 false)에 들어 있다.
// 결과는 서버 코드가 시나리오 첨부 파일에서 결정적으로 계산한다
export interface OdiTool<I extends Record<string, unknown>, R> {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool.InputSchema;
  // 모델이 준 입력 검증 + 기본값 채움. 모르는 키·잘못된 타입은 throw
  parse: (raw: unknown) => I;
  // odi_tools.json 의 sources 에 있어야 하는 키 (값은 첨부 경로)
  sources: string[];
  run: (src: Record<string, string>, input: I) => R;
  // 로그에 남길 핵심 숫자. "기본값 결과와 달라졌는지" 비교에도 쓴다
  summary: (r: R) => Record<string, unknown>;
}

// eslint 없이도 제네릭 목록에 담기 위한 느슨한 타입
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyOdiTool = OdiTool<any, any>;

// 도구 호출 1회의 기록. message.meta.tool_calls 에 쌓여 평가(06 문서)의 발견 증거가 된다
export interface OdiToolLog {
  name: string;
  input: Record<string, unknown>; // 기본값을 채운 최종 입력
  changed_flags: string[]; // 기본값과 다르게 켠 옵션 이름
  defaults_changed: boolean;
  summary: Record<string, unknown> | null;
  // 같은 도구를 기본값으로 돌린 결과와 summary 가 다른가 (= 바꾼 옵션이 실제로 숫자를 바꿨나)
  differs_from_default: boolean | null;
  is_error: boolean;
  error?: string;
}
