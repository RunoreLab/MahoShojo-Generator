export const renderHostedDrClientConfig = (
  stableOrigin,
  previewOrigin,
  controlPlaneProvisioning,
  productionFallbackReadiness,
) => [
  '// 此文件由 config/hosted-dr-capabilities.json 生成，请勿手工编辑。',
  `export const hostedDrStableOrigin = ${JSON.stringify(stableOrigin)} as const;`,
  `export const hostedDrPreviewOrigin = ${JSON.stringify(previewOrigin)} as const;`,
  `export const hostedDrControlPlaneProvisioning = ${JSON.stringify(controlPlaneProvisioning)} as const;`,
  `export const hostedDrProductionFallbackReadiness = ${JSON.stringify(productionFallbackReadiness)} as const;`,
  '',
].join('\n');
