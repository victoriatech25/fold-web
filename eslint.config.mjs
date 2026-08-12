import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "alert", message: "useCommonPopup().alert를 사용하세요." },
        { name: "confirm", message: "useCommonPopup().confirm을 사용하세요." },
        { name: "prompt", message: "useCommonPopup().prompt를 사용하세요." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "alert", message: "useCommonPopup().alert를 사용하세요." },
        { object: "window", property: "confirm", message: "useCommonPopup().confirm을 사용하세요." },
        { object: "window", property: "prompt", message: "useCommonPopup().prompt를 사용하세요." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
