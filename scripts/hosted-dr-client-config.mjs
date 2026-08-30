export const renderHostedDrClientConfig = ({
  contractVersion,
  controlPlane,
  capabilities,
}) => {
  const routing = {
    defaultMode: controlPlane.defaultMode,
    managedControlPlane: controlPlane.managedControlPlane,
    primaryOrigin: controlPlane.primaryOrigin,
    drOrigin: controlPlane.drOrigin,
    primaryProbePath: controlPlane.primaryProbePath,
    drProbePath: controlPlane.drProbePath,
    preflightTimeoutMs: controlPlane.preflightTimeoutMs,
    contractVersion,
  };
  const operations = capabilities.flatMap((capability) => (
    capability.operations.map((operation) => ({
      route: capability.route,
      method: operation.method,
      requestClass: operation.requestClass,
      drMode: operation.drMode,
      replayPolicy: operation.replayPolicy,
      contractStatus: capability.contractStatus,
    }))
  ));

  return [
    '// 此文件由 config/hosted-dr-capabilities.json 生成，请勿手工编辑。',
    `export const hostedDrStableOrigin = ${JSON.stringify(controlPlane.stableOrigin)} as const;`,
    `export const hostedDrPreviewOrigin = ${JSON.stringify(controlPlane.previewOrigin)} as const;`,
    `export const hostedDrControlPlaneProvisioning = ${JSON.stringify(controlPlane.provisioning)} as const;`,
    `export const hostedDrProductionFallbackReadiness = ${JSON.stringify(controlPlane.productionFallback?.artifactReadiness)} as const;`,
    `export const hostedDrClientRouting = ${JSON.stringify(routing, null, 2)} as const;`,
    `export const hostedDrClientOperations = ${JSON.stringify(operations, null, 2)} as const;`,
    '',
  ].join('\n');
};
