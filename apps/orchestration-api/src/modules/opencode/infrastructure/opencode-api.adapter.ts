import { Injectable } from "@nestjs/common";
import type {
  AgentInfo,
  ServerInfo,
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
} from "../application/opencode.gateway";

type AgentListResponse = { data: AgentInfo[] };

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

  async listAgents(): Promise<OpenCodeAgent[]> {
    const query = new URLSearchParams({ directory: this.environment.opencodeWorkspaceRoot });
    const result = await this.request<AgentListResponse>(`/api/agent?${query.toString()}`);
    return result.data.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description ?? null,
      mode: agent.mode,
    }));
  }

  async createSession(input: { title: string; agentId: AgentId }): Promise<OpenCodeSession> {
    const session = await this.request<SessionInfo>("/api/session", {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        agent: input.agentId,
        location: { directory: this.environment.opencodeWorkspaceRoot },
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

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new OpenCodeUnavailableError();
    }

    if (!response.ok) throw new OpenCodeUnavailableError();
    return response.json() as Promise<T>;
  }
}
