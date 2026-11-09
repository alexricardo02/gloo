import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = defineConfig([
     ...nextVitals,
     ...nextTs,
     globalIgnores([
       ".next/**",
       "out/**",
       "build/**",
       "next-env.d.ts",
       "playwright-report/**",
       "test-results/**",
       "coverage/**",
     ]),
   ]);

export default eslintConfig;
