module.exports = {
  clearMocks: true,
  collectCoverageFrom: [
    "apps/orchestration-api/src/modules/opencode/presentation/opencode.controller.ts",
    "!**/*.module.ts",
    "!**/*.d.ts",
  ],
  coverageDirectory: "artifacts/qa/coverage/api",
  coverageReporters: ["text", "lcov", "json-summary"],
  globalSetup: "<rootDir>/apps/orchestration-api/test/jest-global-setup.cjs",
  roots: ["<rootDir>/apps/orchestration-api/test"],
  testEnvironment: "node",
  testMatch: ["**/*.spec.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          allowSyntheticDefaultImports: true,
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
          module: "CommonJS",
          moduleResolution: "Node10",
          strict: true,
          target: "ES2022",
          types: ["jest", "node"],
        },
      },
    ],
  },
};
