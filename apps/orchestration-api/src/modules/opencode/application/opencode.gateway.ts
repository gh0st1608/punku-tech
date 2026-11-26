import type { AgentId } from "@aief/contracts";

export const OPENCODE_GATEWAY = Symbol("OPENCODE_GATEWAY");

export type OpenCodeHealth = {
  status: "ready" | "incompatible" | "unavailable";
  version: string | null;
  requiredVersion: string;
};

export type OpenCodeAgent = {
  id: string;
  name: string;
  description: string | null;
  mode: string;
};

export type OpenCodeSession = {
  id: string;
  title: string | null;
  agentId: string | null;
};

export interface OpenCodeGateway {
  health(): Promise<OpenCodeHealth>;
  listAgents(): Promise<OpenCodeAgent[]>;
  createSession(input: { title: string; agentId: AgentId }): Promise<OpenCodeSession>;
  generate(sessionId: string, prompt: string): Promise<string>;
}
