import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/generated/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { sonarjs },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],
      complexity: ["warn", 12],
      "max-params": ["warn", 4],
      "sonarjs/cognitive-complexity": ["warn", 15],
      "sonarjs/no-duplicate-string": ["warn", 4],
    },
  },
  eslintConfigPrettier,
);
