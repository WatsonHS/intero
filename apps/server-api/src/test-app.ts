import type { Attachment } from "@intero/domain";

import {
  buildApp,
  type BuildAppOptions,
  type ConversationAttachmentService,
} from "./app.js";

const testAttachments: ConversationAttachmentService = {
  async createUpload(): Promise<never> {
    throw new Error("Test attachment service was not configured.");
  },
  async createDownload(): Promise<never> {
    throw new Error("Test attachment service was not configured.");
  },
  async completeUpload(): Promise<never> {
    throw new Error("Test attachment service was not configured.");
  },
  async get(): Promise<Attachment | undefined> {
    return undefined;
  },
  async readContent(): Promise<never> {
    throw new Error("Test attachment service was not configured.");
  },
  async scan(): Promise<never> {
    throw new Error("Test attachment service was not configured.");
  },
  async uploadContent(): Promise<never> {
    throw new Error("Test attachment service was not configured.");
  },
};

type TestBuildAppOptions = Omit<BuildAppOptions, "attachments"> & {
  attachments?: ConversationAttachmentService;
};

export function buildTestApp(options: TestBuildAppOptions = {}) {
  return buildApp({
    ...options,
    allowDevelopmentOrigins: options.allowDevelopmentOrigins ?? true,
    enableLegacyApi: options.enableLegacyApi ?? true,
    attachments: options.attachments ?? testAttachments,
  });
}
