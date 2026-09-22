// ESLint 9 flat config.
// Legacy sources under src/ were moved verbatim (S02) and keep their original
// mixed style (semicolons/quotes vary per file), so stylistic rules are
// deliberately left out. Correctness rules that flag real issues in the
// verbatim legacy files are downgraded to warnings there rather than editing
// the verbatim sources.
import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['dist/**'] },
  js.configs.recommended,
  {
    // Extension code: browser + WebExtension globals.
    files: ['src/**/*.js', 'tests/**/*'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      // Warnings only in legacy verbatim files (do not edit them):
      'no-undef': 'warn', // legacy classic scripts rely on implicit globals (e.g. speechSettings)
      'no-unused-vars': 'warn', // legacy code keeps many intentionally unused vars
      'no-useless-escape': 'warn', // legacy regex/string escapes
      'no-irregular-whitespace': 'warn', // legacy whitespace inside regexes
      'no-prototype-builtins': 'warn', // legacy Object.prototype method access
    },
  },
  {
    // Build tooling runs in Node.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
    },
  },
  // The lint script passes the `tests` directory explicitly; ESLint 9 exits
  // with a fatal "all files ignored" error when a passed directory contains
  // only unconfigured files (tests/ holds just the `.gitkeep` placeholder).
  // `tests/**/*` above is a wildcard-only ("universal") pattern, which cannot
  // apply to `.gitkeep` on its own, so match it specifically to make the
  // directory yield at least one lintable (empty) file.
  { files: ['tests/.gitkeep'] },
]
