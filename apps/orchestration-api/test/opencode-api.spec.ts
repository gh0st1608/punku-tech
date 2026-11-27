import { ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { ExecutionRecord } from "@aief/contracts";
import { ExecutionsService } from "../src/modules/executions/application/executions.service";
import { EXECUTIONS_REPOSITORY } from "../src/modules/executions/application/executions.repository";
import { ExecutionsController } from "../src/modules/executions/presentation/executions.controller";
import type { OpenCodeGateway } from "../src/modules/opencode/application/opencode.gateway";
import { OPENCODE_GATEWAY } from "../src/modules/opencode/application/opencode.gateway";
import { OpenCodeController } from "../src/modules/opencode/presentation/opencode.controller";
import request from "supertest";

describe("OpenCode REST API", () => {
  let app: INestApplication;
  const gateway = {
    health: jest.fn(),
    listAgents: jest.fn(),
    createSession: jest.fn(),
  } as unknown as OpenCodeGateway;
  const executions = {
    create: jest.fn(),
  } as unknown as ExecutionsService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [OpenCodeController, ExecutionsController],
      providers: [
        { provide: OPENCODE_GATEWAY, useValue: gateway },
        { provide: ExecutionsService, useValue: executions },
        {
          provide: EXECUTIONS_REPOSITORY,
          useValue: { exists: jest.fn(), findEventCursor: jest.fn() },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        validationError: { target: false, value: false },
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns runtime health when the adapter is ready", async () => {
    const health = { status: "ready", version: "2.4.2", requiredVersion: "2.4.2" } as const;
    jest.mocked(gateway.health).mockResolvedValue(health);

    await request(app.getHttpServer()).get("/api/runtime/health").expect(200, health);
  });

  it("returns service unavailable when the adapter is not ready", async () => {
    jest.mocked(gateway.health).mockResolvedValue({
      status: "unavailable",
      version: null,
      requiredVersion: "2.4.2",
    });

    await request(app.getHttpServer()).get("/api/runtime/health").expect(503);
  });

  it("creates a session for a valid configured agent", async () => {
    const session = { id: "session-1", title: "Plan", agentId: "backend" };
    jest.mocked(gateway.createSession).mockResolvedValue(session);

    await request(app.getHttpServer())
      .post("/api/runtime/sessions")
      .send({ title: "Plan", agentId: "backend" })
      .expect(201, session);

    expect(gateway.createSession).toHaveBeenCalledWith({ title: "Plan", agentId: "backend" });
  });

  it("rejects unsupported agents and additional request fields", async () => {
    await request(app.getHttpServer())
      .post("/api/runtime/sessions")
      .send({ title: "Plan", agentId: "unknown-agent" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/api/runtime/sessions")
      .send({ title: "Plan", agentId: "backend", secret: "not-accepted" })
      .expect(400);

    expect(gateway.createSession).not.toHaveBeenCalled();
  });

  it("validates and trims execution creation requests", async () => {
    const requirement = "Create a sample project.";
    const execution: ExecutionRecord = {
      id: "2da9a438-7fdc-4318-9caf-4894b73ef13c",
      name: requirement,
      requirement,
      status: "CREATED",
      budgetUsd: null,
      startedAt: null,
      finishedAt: null,
      createdAt: "2026-11-27T10:00:00.000Z",
    };
    jest.mocked(executions.create).mockResolvedValue(execution);

    await request(app.getHttpServer())
      .post("/api/executions")
      .send({ requirement: `  ${requirement}  ` })
      .expect(201, execution);

    expect(executions.create).toHaveBeenCalledWith({ requirement });
  });

  it("rejects short requirements and budgets outside the supported range", async () => {
    await request(app.getHttpServer())
      .post("/api/executions")
      .send({ requirement: "short" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/api/executions")
      .send({ requirement: "A valid requirement string.", budgetUsd: 1001 })
      .expect(400);

    expect(executions.create).not.toHaveBeenCalled();
  });
});
