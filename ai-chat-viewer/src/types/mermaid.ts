export interface MermaidDownloadImagePayload {
  fileStream: Blob;
  fileSize: number;
  filename: string;
  mimeType: 'image/png';
  diagramId: string;
}

export type MermaidDownloadImageHandler = (
  payload: MermaidDownloadImagePayload,
) => Promise<void> | void;

export interface MarkdownRuntimeConfig {
  isStreaming?: boolean;
  isPc?: boolean;
  downloadImage?: MermaidDownloadImageHandler;
}
