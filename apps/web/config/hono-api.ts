import {
  hostedDrControlPlaneProvisioning,
  hostedDrPreviewOrigin,
  hostedDrProductionFallbackReadiness,
  hostedDrStableOrigin,
} from './hosted-dr-client.generated';
import {
  parseHostedApiDeploymentTarget,
  type HostedApiDeploymentTarget,
} from '@mahoshojo/hosted-api/hosted-dr';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const isLoopbackDevelopmentOrigin = (origin: string): boolean => {
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol)
      && LOOPBACK_HOSTS.has(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
};

type HostedApiActivation = {
  controlPlaneProvisioning: 'not-provisioned' | 'preview' | 'production';
  productionFallbackReadiness: 'deferred' | 'verified';
};

type HostedApiConfig = {
  enabled: boolean;
  origin: string;
  target: HostedApiDeploymentTarget;
};

const resolveDeploymentTarget = (value: string | undefined): HostedApiDeploymentTarget => {
  if (!value?.trim()) return 'local';
  const target = parseHostedApiDeploymentTarget(value);
  if (target) return target;
  throw new Error(`NEXT_PUBLIC_HOSTED_API_ENVIRONMENT deployment target 非法: ${value.trim()}`);
};

export const resolveHostedApiConfig = (
  configuredOrigin: string | undefined,
  deploymentTarget: string | undefined,
  activation: HostedApiActivation = {
    controlPlaneProvisioning: hostedDrControlPlaneProvisioning,
    productionFallbackReadiness: hostedDrProductionFallbackReadiness,
  },
): HostedApiConfig => {
  const origin = configuredOrigin?.trim();
  const target = resolveDeploymentTarget(deploymentTarget);

  if (target === 'production') {
    if (origin && origin !== hostedDrStableOrigin) {
      throw new Error(
        'production 环境的 NEXT_PUBLIC_HONO_API_ORIGIN 只能使用 manifest 声明的 stable origin',
      );
    }
    if (activation.controlPlaneProvisioning === 'production') {
      return { enabled: true, origin: hostedDrStableOrigin, target };
    }
    if (!origin && activation.productionFallbackReadiness === 'verified') {
      return { enabled: false, origin: hostedDrStableOrigin, target };
    }
    throw new Error('production Hosted placement 未就绪，拒绝构建');
  }

  if (target === 'preview') {
    if (origin === hostedDrPreviewOrigin) {
      return { enabled: true, origin: hostedDrPreviewOrigin, target };
    }
    throw new Error(
      'preview 环境必须显式使用 manifest 声明的 preview origin，且不得回退到 stable origin',
    );
  }

  if (!origin) {
    return { enabled: false, origin: hostedDrStableOrigin, target };
  }
  if (isLoopbackDevelopmentOrigin(origin)) {
    return { enabled: true, origin, target };
  }
  throw new Error(
    'local/test 的 NEXT_PUBLIC_HONO_API_ORIGIN 只能使用 loopback origin',
  );
};

export const honoApiConfig: HostedApiConfig = resolveHostedApiConfig(
  process.env.NEXT_PUBLIC_HONO_API_ORIGIN,
  process.env.NEXT_PUBLIC_HOSTED_API_ENVIRONMENT,
  // Production clients consume stable/explicit preview logical entries only;
  // physical primary/DR origins remain server/control-plane contract details.
);
