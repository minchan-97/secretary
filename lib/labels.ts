export const KIND_LABEL: Record<string, string> = {
  tool_promotion: '새 도구 등록',
  external_action: '외부로 내보내기',
  knowhow: '노하우 등록',
  budget_increase: '예산 늘리기',
  level_raise: '권한 올리기',
  task_type_proposal: '새 업무 종류',
};

export const STATUS_LABEL: Record<string, string> = {
  queued: '대기',
  running: '진행 중',
  waiting_approval: '결재 대기',
  done: '완료',
  failed: '실패',
  cancelled: '취소',
};

export const ACTOR_LABEL: Record<string, string> = {
  agent: '비서',
  kernel: '커널',
  human: '나',
  system: '시스템',
};

export const OUTCOME_LABEL: Record<string, string> = {
  ok: '완료',
  denied: '막힘',
  error: '오류',
  pending: '대기',
};

export const LEVEL_LABEL: Record<number, string> = {
  0: '0 · 읽기와 검색만',
  1: '1 · 초안 작성과 샌드박스 실행까지',
  2: '2 · 되돌릴 수 있는 내부 수정까지',
  3: '3 · 외부 발송까지 (매번 결재)',
};

const fmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function when(d: Date | string) {
  return fmt.format(typeof d === 'string' ? new Date(d) : d);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
