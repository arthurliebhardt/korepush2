import {
  AppsV1Api,
  BatchV1Api,
  CoreV1Api,
  KubeConfig,
  NetworkingV1Api,
} from "@kubernetes/client-node";

let cached: KubeConfig | null = null;

export function kubeConfig(): KubeConfig {
  if (cached) return cached;
  const kc = new KubeConfig();
  try {
    kc.loadFromCluster();
  } catch {
    kc.loadFromDefault();
  }
  cached = kc;
  return kc;
}

export const apis = () => {
  const kc = kubeConfig();
  return {
    core: kc.makeApiClient(CoreV1Api),
    apps: kc.makeApiClient(AppsV1Api),
    batch: kc.makeApiClient(BatchV1Api),
    networking: kc.makeApiClient(NetworkingV1Api),
  };
};

export type Apis = ReturnType<typeof apis>;
