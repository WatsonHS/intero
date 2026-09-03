import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/index.js";
import {
  callStageClass,
  ConversationCall,
  mediaDeviceFailureError,
} from "./ConversationCall.js";

describe("ConversationCall", () => {
  it("renders accessible audio and video launchers with realtime gating", () => {
    const output = renderToStaticMarkup(
      <I18nProvider>
        <ConversationCall
          enabled
          stageContainerId="call-stage"
          threadId="019f9f20-0000-7000-8000-000000000099"
          currentPrincipalId="019f9f20-0000-7000-8000-000000000001"
          title="Design sync"
          principalNames={new Map()}
          humanParticipantCount={2}
        />
      </I18nProvider>,
    );

    expect(output).toContain('data-testid="start-audio-call"');
    expect(output).toContain('aria-label="发起语音通话"');
    expect(output).toContain('data-testid="start-video-call"');
    expect(output).toContain('aria-label="发起视频通话"');
    expect(output.match(/disabled=""/g)).toHaveLength(2);
  });

  it("preserves specific LiveKit media device failures", () => {
    expect(mediaDeviceFailureError("NotFound", "audioinput")).toBe(
      "chat.microphoneMissing",
    );
    expect(mediaDeviceFailureError("NotFound", "videoinput")).toBe(
      "chat.cameraMissing",
    );
    expect(mediaDeviceFailureError("DeviceInUse", "audioinput")).toBe(
      "chat.mediaDeviceInUse",
    );
    expect(mediaDeviceFailureError("PermissionDenied", "audioinput")).toBe(
      "chat.mediaPermissionDenied",
    );
  });

  it("uses a stable in-conversation stage instead of a draggable window", () => {
    expect(callStageClass("audio", false)).toContain("h-[320px]");
    expect(callStageClass("video", false)).toContain("h-[min(520px,58vh)]");
    expect(callStageClass("video", true)).toContain("h-[68px]");
    expect(callStageClass("video", false)).not.toContain("fixed");
    expect(callStageClass("video", false)).not.toContain("cursor-move");
  });
});
