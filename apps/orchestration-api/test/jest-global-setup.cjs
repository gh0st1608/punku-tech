/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { mkdirSync } = require("node:fs");
const { resolve } = require("node:path");

module.exports = async () => {
  mkdirSync(resolve(process.cwd(), "artifacts/qa/coverage/api"), { recursive: true });
};
