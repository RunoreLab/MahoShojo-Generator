import {
  hostedDrClientRouting,
  hostedDrPreviewOrigin,
  hostedDrStableOrigin,
} from './hosted-routing';
import {
  parseHostedApiDeploymentTarget,
  type HostedApiDeploymentTarget,
} from '@mahoshojo/hosted-api/hosted-dr';
import {
  HOSTED_DR_ACTIVATION_CANDIDATE_ENVIRONMENT,
  parseHostedDrActivationCandidate,
} from '@/lib/hosted-dr/activation-candidate';

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
  activationCandidate?: boolean;
};

export type HostedApiRoutingMode =
  | 'client-preflight'
  | 'static-hono'
  | 'static-next';

export type HostedApiConfig = {
  enabled: boolean;
  origin: string;
  routingMode: HostedApiRoutingMode;
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
    activationCandidate: parseHostedDrActivationCandidate(
      process.env[HOSTED_DR_ACTIVATION_CANDIDATE_ENVIRONMENT],
    ),
  },
): HostedApiConfig => {
  const origin = configuredOrigin?.trim();
  const target = resolveDeploymentTarget(deploymentTarget);

  if (target === 'production') {
    if (activation.activationCandidate === true) {
      if (origin) {
        throw new Error(
          'production activation candidate 禁止配置 NEXT_PUBLIC_HONO_API_ORIGIN',
        );
      }
      return {
        enabled: false,
        origin: hostedDrStableOrigin,
        routingMode: 'static-next',
        target,
      };
    }
    if (origin) {
      throw new Error(
        'client-preflight production 禁止通过 NEXT_PUBLIC_HONO_API_ORIGIN 覆盖 routing origin',
      );
    }
    return {
      enabled: true,
      origin: hostedDrClientRouting.primaryOrigin,
      routingMode: 'client-preflight',
      target,
    };
  }

  if (target === 'preview') {
    if (origin === hostedDrPreviewOrigin) {
      return {
        enabled: true,
        origin: hostedDrPreviewOrigin,
        routingMode: 'static-hono',
        target,
      };
    }
    throw new Error(
      'preview 环境必须显式使用 Hosted routing 声明的 preview origin，且不得回退到 stable origin',
    );
  }

  if (!origin) {
    return {
      enabled: false,
      origin: hostedDrStableOrigin,
      routingMode: 'static-next',
      target,
    };
  }
  if (isLoopbackDevelopmentOrigin(origin)) {
    return { enabled: true, origin, routingMode: 'static-hono', target };
  }
  throw new Error(
    'local/test 的 NEXT_PUBLIC_HONO_API_ORIGIN 只能使用 loopback origin',
  );
};

export const honoApiConfig: HostedApiConfig = resolveHostedApiConfig(
  process.env.NEXT_PUBLIC_HONO_API_ORIGIN,
  process.env.NEXT_PUBLIC_HOSTED_API_ENVIRONMENT,
  // Production client-preflight consumes the small public routing config;
  // preview/local remain explicit.
);
