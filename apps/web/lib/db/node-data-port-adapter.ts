import type {
  NodeDataD1Client,
  NodeDataD1Statement,
} from '@mahoshojo/hosted-runtime/node-runtime/data-ports';

type RuntimeD1Statement = {
  bind(..._params: unknown[]): RuntimeD1Statement;
  run(): Promise<unknown>;
  all(): Promise<unknown>;
};

type RuntimeD1Client = {
  prepare(_sql: string): RuntimeD1Statement;
};

export const adaptRuntimeD1ClientForNodeDataPorts = (
  client: RuntimeD1Client,
): NodeDataD1Client => ({
  prepare: (sql): NodeDataD1Statement => {
    let prepared = client.prepare(sql);
    const adapter: NodeDataD1Statement = {
      bind: (...params) => {
        prepared = prepared.bind(...params);
        return adapter;
      },
      run: async () => await prepared.run() as Awaited<ReturnType<NodeDataD1Statement['run']>>,
      all: async () => await prepared.all() as Awaited<ReturnType<NodeDataD1Statement['all']>>,
    };
    return adapter;
  },
});
