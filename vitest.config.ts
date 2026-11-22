// Tests: the Vite config plus coverage of the logic (src/lib, the todoom
// command). `npm run test:coverage` fails when coverage drops below the
// thresholds, set just under the level reached in November 2026: raise them
// as tests are added, never lower them.
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      coverage: {
        provider: "v8",
        include: ["src/lib/**", "cli/**"],
        exclude: ["**/*.test.ts"],
        reporter: ["text-summary", "html"],
        thresholds: { statements: 58, branches: 60, functions: 58, lines: 56 },
      },
    },
  }),
);
