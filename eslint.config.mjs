// ESLint flat config for the whole SyncBoard monorepo.
//
// One config at the root covers every workspace, so `npm run lint`
// from the root and from any workspace lints the same way.
// typescript-eslint "recommended" is the baseline: it catches real
// mistakes (unused locals, unsafe any use in the obvious places)
// without the slower type-checked rules. react-hooks runs on the
// web app only, where hooks actually live.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    // Built output and dependencies are never linted.
    ignores: ["**/dist/**", "**/node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Server and shared code run on Node.
    files: ["apps/sync-server/src/**/*.ts", "packages/shared/src/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // The web app runs in the browser and uses React hooks.
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
    languageOptions: {
      globals: globals.browser,
    },
  },
);
