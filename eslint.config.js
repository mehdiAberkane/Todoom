// Lint rules: the recommended sets of ESLint and typescript-eslint, plus the
// two classic React hooks rules (hooks called in order, effect dependencies).
// The React Compiler rules of eslint-plugin-react-hooks 7 stay off: Todoom
// doesn't use the compiler, and its refs-in-render patterns are deliberate.
// Run with `npm run lint`; the CI runs it on every push.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const unused = ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true }];

export default tseslint.config(
  { ignores: ["dist", "dist-cli", "coverage", "src-tauri", "node_modules", "agent"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": unused,
    },
  },
  {
    files: ["cli/**/*.ts", "scripts/**/*.mjs", "*.config.{js,ts}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/no-unused-vars": unused },
  },
);
