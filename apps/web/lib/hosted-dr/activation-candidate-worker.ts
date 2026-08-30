import {
  createHostedDrActivationCandidateRestrictedResponse,
  isHostedDrActivationCandidateRequestAllowed,
} from './activation-candidate';

type WorkerLike<Environment, Context> = {
  fetch: (
    request: Request,
    environment: Environment,
    context: Context,
  ) => Promise<Response> | Response;
};

export const createHostedDrActivationCandidateWorker = <Environment, Context>(
  upstream: WorkerLike<Environment, Context>,
): WorkerLike<Environment, Context> => ({
  async fetch(request, environment, context) {
    const { pathname } = new URL(request.url);
    if (!isHostedDrActivationCandidateRequestAllowed(pathname, request.method)) {
      return createHostedDrActivationCandidateRestrictedResponse();
    }

    return upstream.fetch(request, environment, context);
  },
});
