import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],

      // Turn OFF — too noisy, low value for this codebase
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-control-regex": "off",

      // Downgrade to WARN — useful signal but shouldn't block builds
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-deprecated": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
    },
  },
  {
    // Test file overrides - relax rules for common test patterns
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**"],
  }
);
