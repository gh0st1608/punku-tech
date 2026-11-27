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

export type OpenCodeAssistantResult = {
  finish: string | null;
  summary: string | null;
  artifactPaths: string[];
};

export type OpenCodeSessionEvent = {
  id: string;
  type: string;
  createdAt: Date;
  sessionId: string;
};

export interface OpenCodeGateway {
  health(): Promise<OpenCodeHealth>;
  listAgents(directory?: string): Promise<OpenCodeAgent[]>;
  createSession(input: {
    title: string;
    agentId: AgentId;
    directory?: string;
  }): Promise<OpenCodeSession>;
  generate(sessionId: string, prompt: string): Promise<string>;
  prompt(sessionId: string, prompt: string): Promise<void>;
  hasPrompt(sessionId: string, prompt: string): Promise<boolean>;
  wait(sessionId: string): Promise<void>;
  interrupt(sessionId: string): Promise<boolean>;
  latestAssistantResult(sessionId: string): Promise<OpenCodeAssistantResult | null>;
  subscribeSessionEvents(signal: AbortSignal): AsyncIterable<OpenCodeSessionEvent>;
}
