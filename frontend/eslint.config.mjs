import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Disable rules that are too strict for this project
      "@typescript-eslint/no-unused-vars": "warn", // Change to warning instead of error
      "@typescript-eslint/no-explicit-any": "warn", // Change to warning instead of error (needed for external libs)
      "@typescript-eslint/ban-ts-comment": "warn", // Change to warning instead of error
      "prefer-const": "warn", // Change to warning instead of error
      "react-hooks/exhaustive-deps": "warn", // Already a warning, but make sure
      "@next/next/no-img-element": "warn", // Change to warning instead of error
      "@typescript-eslint/no-empty-object-type": "warn", // Change to warning instead of error
    },
  },
];

export default eslintConfig;
