// Flat-config ESLint baseline (typescript-eslint v8, type-aware).
// Deliberately MINIMAL — four hand-picked rules, not a recommended preset — so the
// finding count is a meaningful signal, not preset noise. Advisory for now: `npm run
// lint` is NOT wired into the CI gate (`typecheck && test:all`) yet; flip it to a
// blocking step once the residual findings recorded in notes/refactor-roadmap.md
// are triaged to zero. See notes/registries.md for the frozen-name boundaries.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Not source we own / not in tsconfig → keep them out of type-aware linting.
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "next-env.d.ts",
      "scripts/**", // plain .mjs, not part of tsconfig's program
      "**/*.config.mjs", // this file + any other flat configs
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      // Unawaited promises are the most likely real bug in an async server path
      // (e.g. a dropped upsertLead). Type-aware; needs the program above.
      "@typescript-eslint/no-floating-promises": "error",
      // The codebase already prefers `import type` (lead-dto.ts, store.ts …); make it law.
      "@typescript-eslint/consistent-type-imports": "error",
      // `_`-prefixed args/vars are intentional throwaways (the repo's convention).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
