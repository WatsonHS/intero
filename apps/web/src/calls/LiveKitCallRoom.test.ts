import { describe, expect, it } from "vitest";

import {
  callControlBarControls,
  INITIAL_CALL_MEDIA,
} from "./LiveKitCallRoom.js";

describe("LiveKitCallRoom", () => {
  it("does not render the layout-dependent settings toggle", () => {
    expect(callControlBarControls("audio")).toEqual({
      microphone: true,
      camera: true,
      screenShare: false,
      chat: false,
      leave: true,
      settings: false,
    });
    expect(callControlBarControls("video").screenShare).toBe(true);
  });

  it("joins without forcing unavailable capture devices", () => {
    expect(INITIAL_CALL_MEDIA).toEqual({
      audio: false,
      video: false,
    });
  });
});
