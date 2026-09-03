"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  ManagedModelCatalogResponse,
  ManagedModelCapabilities,
  ManagedModelKind,
  ManagedModelPublicDto,
} from "@/lib/models/contracts";
import { api } from "./api";

export function useManagedModelCatalog() {
  return useQuery<ManagedModelCatalogResponse>({
    queryKey: ["managed-model-catalog"],
    queryFn: () => api("/api/models"),
    staleTime: 30_000,
  });
}

export function enabledManagedModels(
  data: ManagedModelCatalogResponse | undefined,
  kind: ManagedModelKind
): ManagedModelPublicDto[] {
  return data?.items.filter((item) => item.kind === kind && item.enabled) ?? [];
}

export function managedModel(
  data: ManagedModelCatalogResponse | undefined,
  key: string
): ManagedModelPublicDto | undefined {
  return data?.items.find((item) => item.key === key);
}

export function managedCapabilities<T extends ManagedModelCapabilities>(
  data: ManagedModelCatalogResponse | undefined,
  key: string,
  fallback: T
): T {
  return (managedModel(data, key)?.capabilities as T | undefined) ?? fallback;
}
