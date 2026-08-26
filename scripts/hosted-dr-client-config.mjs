export const renderHostedDrClientConfig = (stableOrigin, previewOrigin) => [
  '// 此文件由 config/hosted-dr-capabilities.json 生成，请勿手工编辑。',
  `export const hostedDrStableOrigin = ${JSON.stringify(stableOrigin)} as const;`,
  `export const hostedDrPreviewOrigin = ${JSON.stringify(previewOrigin)} as const;`,
  '',
].join('\n');
