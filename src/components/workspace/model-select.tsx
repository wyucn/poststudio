"use client";

import { modelsByKind, type ModelKind } from "@/lib/ark/models";
import { enabledManagedModels, useManagedModelCatalog } from "@/lib/client/models";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ModelSelect({
  kind,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  kind: ModelKind;
  value: string;
  onChange: (key: string) => void;
  className?: string;
  ariaLabel: string;
}) {
  const catalog = useManagedModelCatalog();
  const managed = enabledManagedModels(catalog.data, kind);
  const models = catalog.data
    ? managed
    : modelsByKind(kind).map((model) => ({
        key: model.key,
        label: model.label,
        description: model.description,
      }));
  return (
    <Select value={value} onValueChange={onChange} disabled={!models.length}>
      <SelectTrigger aria-label={ariaLabel} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {models.map((m) => (
          <SelectItem key={m.key} value={m.key}>
            {m.label}
            <span className="ml-2 text-xs text-muted-foreground">{m.description}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
