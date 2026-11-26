import { Injectable } from "@nestjs/common";
import type {
  AgentInfo,
  ServerInfo,
  SessionMessagesResponse,
  SessionGenerateOutput,
  SessionInfo,
} from "@opencode/client" with {
  "resolution-mode": "import",
};
import type { AgentId } from "@aief/contracts";
import type { AppEnvironment } from "../../../config/app-environment";
import { OpenCodeUnavailableError } from "../application/opencode-unavailable.error";
import type {
  OpenCodeAgent,
  OpenCodeGateway,
  OpenCodeHealth,
  OpenCodeSession,
  OpenCodeSessionEvent,
} from "../application/opencode.gateway";

type AgentListResponse = { data: AgentInfo[] };

const sessionEventTypes = [
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.step.started",
  "session.step.ended",
  "session.step.failed",
  "session.tool.called",
  "session.tool.success",
  "session.tool.failed",
  "session.usage.updated",
  "permission.asked",
  "permission.replied",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSseData(frame: string): unknown | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;

  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function readSessionEvent(value: unknown): {
  id: string;
  type: string;
  created: number;
  sessionId: string;
} | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const session = value.data.sessionID;
  const isValidEvent =
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    sessionEventTypes.includes(value.type) &&
    typeof value.created === "number" &&
    Number.isFinite(value.created) &&
    typeof session === "string";
  if (!isValidEvent) return null;

  return {
    id: value.id as string,
    type: value.type as string,
    created: value.created as number,
    sessionId: session as string,
  };
}

function parseSessionEvent(frame: string): OpenCodeSessionEvent | null {
  const event = readSessionEvent(parseSseData(frame));
  if (!event) return null;

  const createdAt = new Date(event.created);
  if (Number.isNaN(createdAt.getTime())) return null;

  return {
    id: event.id,
    type: event.type,
    createdAt,
    sessionId: event.sessionId,
  };
}

@Injectable()
export class OpenCodeApiAdapter implements OpenCodeGateway {
  constructor(private readonly environment: AppEnvironment) {}

  async health(): Promise<OpenCodeHealth> {
    try {
      const info = await this.request<ServerInfo>("/api/info");
      return {
        status:
          info.version === this.environment.opencodeRequiredVersion ? "ready" : "incompatible",
        version: info.version,
        requiredVersion: this.environment.opencodeRequiredVersion,
      };
    } catch {
      return {
        status: "unavailable",
        version: null,
        requiredVersion: this.environment.opencodeRequiredVersion,
      };
    }
  }

  async listAgents(directory = this.environment.opencodeWorkspaceRoot): Promise<OpenCodeAgent[]> {
    const query = new URLSearchParams({ directory });
    const result = await this.request<AgentListResponse>(`/api/agent?${query.toString()}`);
    return result.data.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description ?? null,
      mode: agent.mode,
    }));
  }

  async createSession(input: {
    title: string;
    agentId: AgentId;
    directory?: string;
  }): Promise<OpenCodeSession> {
    const session = await this.request<SessionInfo>("/api/session", {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        agent: input.agentId,
        location: { directory: input.directory ?? this.environment.opencodeWorkspaceRoot },
      }),
    });
    return {
      id: session.id,
      title: session.title ?? null,
      agentId: session.agent ?? null,
    };
  }

  async generate(sessionId: string, prompt: string): Promise<string> {
    const response = await this.request<SessionGenerateOutput>(
      `/api/session/${encodeURIComponent(sessionId)}/generate`,
      { method: "POST", body: JSON.stringify({ prompt }) },
    );
    return response.text;
  }

  async prompt(sessionId: string, prompt: string): Promise<void> {
    await this.request(`/api/session/${encodeURIComponent(sessionId)}/prompt`, {
      method: "POST",
      body: JSON.stringify({ text: prompt }),
    });
  }

  async hasPrompt(sessionId: string, prompt: string): Promise<boolean> {
    const query = new URLSearchParams({ limit: "50", order: "desc", type: "user" });
    const response = await this.request<SessionMessagesResponse>(
      `/api/session/${encodeURIComponent(sessionId)}/message?${query.toString()}`,
    );
    return response.data.some((message) => message.type === "user" && message.text === prompt);
  }

  async wait(sessionId: string): Promise<void> {
    await this.request(
      `/api/experimental/session/${encodeURIComponent(sessionId)}/wait`,
      { method: "POST" },
      30 * 60 * 1000,
    );
  }

  async interrupt(sessionId: string): Promise<boolean> {
    const response = await this.request<{ interrupted: boolean }>(
      `/api/session/${encodeURIComponent(sessionId)}/interrupt`,
      { method: "POST" },
    );
    return response.interrupted;
  }

  async latestAssistantResult(sessionId: string) {
    const query = new URLSearchParams({ limit: "1", order: "desc", type: "assistant" });
    const response = await this.request<SessionMessagesResponse>(
      `/api/session/${encodeURIComponent(sessionId)}/message?${query.toString()}`,
    );
    const latestAssistant = response.data.find((message) => message.type === "assistant");
    return latestAssistant ? { finish: latestAssistant.finish ?? null } : null;
  }

  async *subscribeSessionEvents(signal: AbortSignal): AsyncIterable<OpenCodeSessionEvent> {
    const query = new URLSearchParams();
    for (const eventType of sessionEventTypes) query.append("types", eventType);

    const headers = new Headers({ accept: "text/event-stream" });
    if (this.environment.opencodePassword) {
      const credentials = Buffer.from(`opencode:${this.environment.opencodePassword}`).toString(
        "base64",
      );
      headers.set("authorization", `Basic ${credentials}`);
    }

    let response: Response;
    try {
      response = await fetch(
        new URL(`/api/event?${query.toString()}`, `${this.environment.opencodeBaseUrl}/`),
        {
          headers,
          signal,
        },
      );
    } catch {
      if (signal.aborted) return;
      throw new OpenCodeUnavailableError();
    }
    if (!response.ok || !response.body) throw new OpenCodeUnavailableError();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = /\r?\n\r?\n/.exec(buffer);
        while (boundary && boundary.index !== undefined) {
          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          const event = parseSessionEvent(frame);
          if (event) yield event;
          boundary = /\r?\n\r?\n/.exec(buffer);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = 5000): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    if (this.environment.opencodePassword) {
      const credentials = Buffer.from(`opencode:${this.environment.opencodePassword}`).toString(
        "base64",
      );
      headers.set("authorization", `Basic ${credentials}`);
    }

    let response: Response;
    try {
      response = await fetch(new URL(path, `${this.environment.opencodeBaseUrl}/`), {
        ...init,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new OpenCodeUnavailableError();
    }

    if (!response.ok) throw new OpenCodeUnavailableError();
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}
