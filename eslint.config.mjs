import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

// Incremental correctness gate across the entire app. Formatting is separate;
// do not disable safety checks to hide existing legacy style issues.
export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "work/**",
      "output/**",
      "outputs/**",
      "tmp/**",
      "coverage/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    // Preserve legacy suppressions for rules outside this incremental gate.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "constructor-super": "error",
      "for-direction": "error",
      "no-async-promise-executor": "error",
      "no-compare-neg-zero": "error",
      "no-cond-assign": ["error", "always"],
      "no-constant-binary-expression": "error",
      "no-debugger": "error",
      "no-dupe-else-if": "error",
      "no-duplicate-case": "error",
      "no-loss-of-precision": "error",
      "no-promise-executor-return": "error",
      "no-self-assign": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
];
