import type { AssetDto } from "@/lib/client/types";
import {
  type UploadMediaKind,
  validateUploadCandidate,
} from "@/lib/media-policy";

export interface AssetUploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export function uploadAssetFile({
  projectId,
  file,
  allowedKinds,
  maxFileSizeMb,
  onProgress,
}: {
  projectId: string;
  file: File;
  allowedKinds?: UploadMediaKind[];
  maxFileSizeMb?: number;
  onProgress?: (progress: AssetUploadProgress) => void;
}): Promise<AssetDto> {
  const { mime } = validateUploadCandidate(file, allowedKinds, maxFileSizeMb);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/projects/${projectId}/upload`);
    request.timeout = 10 * 60 * 1000;
    request.setRequestHeader("Content-Type", mime);
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.upload.onprogress = (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      const loaded = Math.min(event.loaded, total);
      onProgress?.({
        loaded,
        total,
        percent: total > 0 ? Math.round((loaded / total) * 100) : 0,
      });
    };
    request.onload = () => {
      let data: { error?: string } | AssetDto | null = null;
      try {
        data = JSON.parse(request.responseText) as { error?: string } | AssetDto;
      } catch {}
      if (request.status >= 200 && request.status < 300 && data) {
        onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
        resolve(data as AssetDto);
        return;
      }
      if (request.status === 401 && process.env.NEXT_PUBLIC_AUTH_MODE === "cas") {
        const loginUrl = process.env.NEXT_PUBLIC_CAS_LOGIN_URL;
        if (!loginUrl) {
          reject(new Error("CAS 登录地址未配置"));
          return;
        }
        const separator = loginUrl.includes("?") ? "&" : "?";
        window.location.href = `${loginUrl}${separator}service=${encodeURIComponent(window.location.href)}`;
        return;
      }
      const message = data && "error" in data ? data.error : undefined;
      reject(new Error(message || `上传失败 (${request.status || "网络错误"})`));
    };
    request.onerror = () => reject(new Error("网络连接中断，请检查网络后重新上传"));
    request.ontimeout = () => reject(new Error("上传超时，请检查网络或压缩文件后重试"));
    request.onabort = () => reject(new Error("上传已取消"));
    request.send(file);
  });
}
