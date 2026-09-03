"use client";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import type { AssetDto } from "@/lib/client/types";
import {
  ImagePanel,
  MusicPanel,
  FormulaPanel,
  TtsPanel,
  VideoPanel,
} from "./create/lazy-creators";

export type CreateTabKind = "image" | "video" | "music" | "tts" | "formula";

export function CreateTab({
  projectId,
  extendAsset,
  value,
  onValueChange,
  projectName,
  initialFormulaAsset,
}: {
  projectId: string;
  extendAsset?: AssetDto | null;
  value: CreateTabKind;
  onValueChange: (value: CreateTabKind) => void;
  projectName?: string;
  initialFormulaAsset?: AssetDto | null;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next as CreateTabKind)}
      className="h-full min-h-0"
    >
      <TabsContent value="image" className="mt-0 h-full min-h-0">
        <ImagePanel projectId={projectId} projectName={projectName} />
      </TabsContent>
      <TabsContent value="video" className="mt-0 h-full min-h-0">
        <VideoPanel
          projectId={projectId}
          initialExtendAsset={extendAsset}
          projectName={projectName}
        />
      </TabsContent>
      <TabsContent value="music" className="mt-0 h-full min-h-0">
        <MusicPanel projectId={projectId} projectName={projectName} />
      </TabsContent>
      <TabsContent value="tts" className="mt-0 h-full min-h-0">
        <TtsPanel projectId={projectId} projectName={projectName} />
      </TabsContent>
      <TabsContent value="formula" className="mt-0 h-full min-h-0">
        <FormulaPanel
          projectId={projectId}
          initialFormulaAsset={initialFormulaAsset}
          projectName={projectName}
        />
      </TabsContent>
    </Tabs>
  );
}
