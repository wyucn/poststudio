import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // These maintenance utilities intentionally run as CommonJS so they can be
    // invoked directly with `node` on both the local and server environments.
    files: ["scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    ".e2e/**",
    // Third-party minified browser bundle; its source is covered by the
    // upstream project and must not be parsed as application TypeScript.
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
