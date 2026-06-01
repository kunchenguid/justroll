// @ts-check
import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import globals from "globals";

export default defineConfig(
  eslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // Best-effort cleanup blocks are idiomatic here (telemetry, process teardown).
      "no-empty": ["error", { allowEmptyCatch: true }],
      // This is a terminal app; stripping ANSI legitimately matches control chars.
      "no-control-regex": "off",
    },
  },
  {
    // Test files run under node:test.
    files: ["test/**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    ignores: ["node_modules/", ".preview/", ".spike/", ".lavish/"],
  },
);
