import nextVitals from "eslint-config-next/core-web-vitals";

// eslint-config-next@16 只发布原生 flat config——core-web-vitals 入口已
// 内置 typescript 块与全局 ignores（等价旧 extends core-web-vitals +
// typescript），不再经 FlatCompat 桥接。
const eslintConfig = [
  {
    ignores: ["lib/vendor/**"],
  },
  ...nextVitals,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@next/next/no-img-element": "off",
      // eslint-config-next@16 顺带启用了 react-hooks 的 React Compiler
      // 规则集；本仓库既有门禁口径是经典 rules-of-hooks/exhaustive-deps
      // (warn)，这批规则命中约 196 处既有实现模式，逐条整改属独立评估
      // ——本次版本升级先恢复旧门禁口径，不借机静默抬高门槛。
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
    },
  },

];

export default eslintConfig;
