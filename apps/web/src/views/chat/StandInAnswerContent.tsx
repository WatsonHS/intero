import type { PilotStandInAnswerDetail } from "@intero/domain";
import type { ReactNode } from "react";

function AnswerLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-2.5 text-[11.5px] leading-[1.6]">
      <strong className="font-[620] text-faint">{label}</strong>
      <span className="text-ink-muted [text-wrap:pretty]">{children}</span>
    </div>
  );
}

export function StandInAnswerContent({
  answer,
  testId,
}: {
  answer: PilotStandInAnswerDetail;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="mt-3 grid gap-2.5 rounded-[10px] bg-raise p-[11px_13px]"
    >
      <AnswerLine label="当前状态">{answer.currentStatus}</AnswerLine>
      <AnswerLine label="已完成">
        {answer.completedOutcome || "尚无已完成结果"}
      </AnswerLine>
      <AnswerLine label="结果依据">
        {answer.evidence.length > 0
          ? answer.evidence.join("；")
          : "当前 Work State 未提供单独依据"}
      </AnswerLine>
      <AnswerLine label="下一步">
        {answer.nextStep || "尚未明确下一步"}
      </AnswerLine>
      <AnswerLine label="需要协作">
        {answer.neededCollaboration || "暂不需要他人协助"}
      </AnswerLine>
    </div>
  );
}
