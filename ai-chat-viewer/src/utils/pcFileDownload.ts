export interface PcFileDownloadPayload {
  fileStream: Blob;
  fileSize: number;
  filename: string;
  mimeType?: string;
  extensions?: string[];
}

export type PcFileDownloadErrorCode = 'unsupported' | 'dialog_failed' | 'write_failed';

export interface PcFileDownloadError extends Error {
  code: PcFileDownloadErrorCode;
  cause?: unknown;
}

interface SaveDialogPayload {
  filters: Array<{ name: 'Files'; extensions: string[] }>;
  defaultPath: string;
}

interface SaveDialogResult {
  canceled?: boolean;
  filePath?: string;
}

interface FsLike {
  promises?: {
    writeFile?: (path: string, data: Uint8Array) => Promise<void>;
  };
  writeFile?: (path: string, data: Uint8Array, callback: (error?: Error | null) => void) => void;
}

function createPcFileDownloadError(
  code: PcFileDownloadErrorCode,
  message: string,
  cause?: unknown,
): PcFileDownloadError {
  const error = new Error(message) as PcFileDownloadError;
  error.code = code;
  error.cause = cause;
  return error;
}

export function isPcFileDownloadError(error: unknown): error is PcFileDownloadError {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'unsupported' || code === 'dialog_failed' || code === 'write_failed';
}

function sanitizeFilename(filename: string, extensions: string[]): string {
  const fallback = extensions[0] ? `mermaid-chart.${extensions[0]}` : 'mermaid-chart.png';
  const basename = filename
    .split(/[\\/]/)
    .pop()
    ?.trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ');
  let safeName = basename || fallback;
  const primaryExtension = extensions[0];
  if (primaryExtension && !safeName.toLowerCase().endsWith(`.${primaryExtension.toLowerCase()}`)) {
    safeName = `${safeName}.${primaryExtension}`;
  }
  return safeName;
}

function joinDefaultPath(folder: string, filename: string): string {
  const trimmedFolder = folder.trim();
  if (!trimmedFolder) {
    return filename;
  }
  const withoutTrailingSeparators = trimmedFolder.replace(/[\\/]+$/, '');
  const separator = trimmedFolder.includes('\\') && !trimmedFolder.includes('/') ? '\\' : '/';
  return `${withoutTrailingSeparators}${separator}${filename}`;
}

function getPedestal() {
  const pedestal = window.Pedestal;
  const showSaveDialog = pedestal?.remote?.dialog?.showSaveDialog;
  if (
    !pedestal
    || typeof pedestal.callMethod !== 'function'
    || typeof showSaveDialog !== 'function'
  ) {
    throw createPcFileDownloadError(
      'unsupported',
      'Pedestal save dialog is not available.',
    );
  }
  return { pedestal, showSaveDialog };
}

function getFs(): FsLike {
  const requireFn = window.require;
  if (typeof requireFn !== 'function') {
    throw createPcFileDownloadError('unsupported', 'window.require is not available.');
  }

  let fsModule: FsLike;
  try {
    fsModule = requireFn('fs') as FsLike;
  } catch (error) {
    throw createPcFileDownloadError('unsupported', 'fs module is not available.', error);
  }

  if (
    typeof fsModule?.promises?.writeFile !== 'function'
    && typeof fsModule?.writeFile !== 'function'
  ) {
    throw createPcFileDownloadError('unsupported', 'fs.writeFile is not available.');
  }

  return fsModule;
}

async function getDefaultFolder(pedestal: NonNullable<typeof window.Pedestal>): Promise<string> {
  try {
    const result = await pedestal.callMethod('method://pedestal/getLocalSettingInfo', {});
    const folder = (result as { fileDownloadFolderAddress?: unknown } | null)?.fileDownloadFolderAddress;
    return typeof folder === 'string' ? folder : '';
  } catch (_error) {
    return '';
  }
}

function writeFile(fsModule: FsLike, filePath: string, bytes: Uint8Array): Promise<void> {
  if (typeof fsModule.promises?.writeFile === 'function') {
    return fsModule.promises.writeFile(filePath, bytes);
  }

  return new Promise((resolve, reject) => {
    fsModule.writeFile?.(filePath, bytes, (error?: Error | null) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read blob.'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob.'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function downloadFileWithPedestal(payload: PcFileDownloadPayload): Promise<void> {
  if (!(payload.fileStream instanceof Blob) || typeof payload.filename !== 'string' || !payload.filename.trim()) {
    throw createPcFileDownloadError('unsupported', 'Invalid file download payload.');
  }

  const extensions = payload.extensions && payload.extensions.length > 0
    ? payload.extensions.map((item) => item.replace(/^\./, '').toLowerCase()).filter(Boolean)
    : ['png'];
  const safeFilename = sanitizeFilename(payload.filename, extensions);
  const { pedestal, showSaveDialog } = getPedestal();
  const fsModule = getFs();
  const defaultFolder = await getDefaultFolder(pedestal);
  const saveDialogPayload: SaveDialogPayload = {
    filters: [{ name: 'Files', extensions }],
    defaultPath: joinDefaultPath(defaultFolder, safeFilename),
  };

  let dialogResult: SaveDialogResult;
  try {
    dialogResult = await showSaveDialog(saveDialogPayload) as SaveDialogResult;
  } catch (error) {
    throw createPcFileDownloadError('dialog_failed', 'Failed to open save dialog.', error);
  }

  if (dialogResult?.canceled) {
    return;
  }

  if (!dialogResult?.filePath) {
    throw createPcFileDownloadError('dialog_failed', 'Save dialog did not return a file path.');
  }

  try {
    const buffer = await readBlobAsArrayBuffer(payload.fileStream);
    await writeFile(fsModule, dialogResult.filePath, new Uint8Array(buffer));
  } catch (error) {
    throw createPcFileDownloadError('write_failed', 'Failed to write file.', error);
  }
}
