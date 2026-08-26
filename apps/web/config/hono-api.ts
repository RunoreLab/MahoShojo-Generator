import { hostedDrStableOrigin } from './hosted-dr-client.generated';

export const honoApiConfig = {
  enabled: true,
  // Installed clients consume only the logical control-plane entry. Physical
  // primary/DR origins remain server/control-plane contract details.
  origin: hostedDrStableOrigin,
};
