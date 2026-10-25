import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // src/core is pure (AD dependency rules): no clock, network or process access.
    files: ["src/core/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "src/core is pure: no network access; fetch in a module and pass the data in." },
        { name: "process", message: "src/core is pure: no process or environment access; pass values in." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "src/core is pure: no Date.now(); pass today in.",
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: "src/core is pure: no new Date(); pass today in as a YYYY-MM-DD business date.",
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "src/db/generated/**",
    "_bmad/**",
    "_bmad-output/**",
    ".bmad-loop/**",
    ".claude/**",
  ]),
]);
