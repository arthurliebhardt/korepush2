import { KubeConfig, CoreV1Api } from "@kubernetes/client-node";

const g = globalThis as unknown as { __korepushKc?: KubeConfig };

export function kubeConfig(): KubeConfig {
  if (g.__korepushKc) return g.__korepushKc;
  const kc = new KubeConfig();
  try {
    kc.loadFromCluster();
  } catch {
    kc.loadFromDefault();
  }
  g.__korepushKc = kc;
  return kc;
}

export function coreApi(): CoreV1Api {
  return kubeConfig().makeApiClient(CoreV1Api);
}
