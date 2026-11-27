import { Body, Controller, Get, Inject, Post, ServiceUnavailableException } from "@nestjs/common";
import { OpenCodeUnavailableError } from "../application/opencode-unavailable.error";
import { OPENCODE_GATEWAY } from "../application/opencode.gateway";
import type { OpenCodeGateway } from "../application/opencode.gateway";
import type { CreateOpenCodeSessionDto } from "./dto/create-opencode-session.dto";

@Controller("runtime")
export class OpenCodeController {
  constructor(@Inject(OPENCODE_GATEWAY) private readonly openCode: OpenCodeGateway) {}

  @Get("health")
  async health() {
    const result = await this.openCode.health();
    if (result.status !== "ready") {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }

  @Get("agents")
  async agents() {
    try {
      return await this.openCode.listAgents();
    } catch (error) {
      if (error instanceof OpenCodeUnavailableError)
        throw new ServiceUnavailableException(error.message);
      throw error;
    }
  }

  @Post("sessions")
  async createSession(@Body() body: CreateOpenCodeSessionDto) {
    try {
      return await this.openCode.createSession({ title: body.title, agentId: body.agentId });
    } catch (error) {
      if (error instanceof OpenCodeUnavailableError)
        throw new ServiceUnavailableException(error.message);
      throw error;
    }
  }
}
