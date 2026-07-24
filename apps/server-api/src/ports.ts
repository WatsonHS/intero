export interface AuthorizationPort {
  check(input: {
    principalId: string;
    permission: string;
    resourceType: string;
    resourceId: string;
    consistencyToken?: string;
  }): Promise<{ allowed: boolean; consistencyToken?: string }>;
}

export interface QueuePort {
  publish(
    topic: string,
    payload: Record<string, unknown>,
    operationId: string,
  ): Promise<void>;
}

export interface RealtimePort {
  publish(channel: string, event: Record<string, unknown>): Promise<void>;
}

export interface ObjectStorePort {
  createUpload(input: {
    objectId: string;
    checksum: string;
    contentType: string;
    encrypted: boolean;
  }): Promise<{ uploadUrl: string; expiresAt: string }>;
  markScanned(
    objectId: string,
    result: "clean" | "infected" | "failed",
  ): Promise<void>;
}

export class FailClosedAuthorization implements AuthorizationPort {
  async check(): Promise<{ allowed: boolean }> {
    return { allowed: false };
  }
}
