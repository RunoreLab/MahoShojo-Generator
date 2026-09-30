import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

// 这里使用 `@typescript-eslint` 的 no-unused-vars 而不是 ESLint 内置版本：
// 内置规则会把 TypeScript 调用签名（`interface F { (a: string): void }`）的参数
// 当成未使用的函数参数报错，desktop 的窄桥正需要这种签名来约束 invoke 形状。
export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
];
