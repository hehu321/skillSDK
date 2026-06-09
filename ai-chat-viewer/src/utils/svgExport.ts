export interface SvgToPngResult {
  fileStream: Blob;
  fileSize: number;
}

export interface SvgToPngOptions {
  maxWidth?: number;
  maxHeight?: number;
  timeoutMs?: number;
}

interface SvgSize {
  width: number;
  height: number;
}

const DEFAULT_MAX_WIDTH = 4096;
const DEFAULT_MAX_HEIGHT = 4096;
const DEFAULT_TIMEOUT_MS = 5000;

function parseLength(value: string | null): number {
  if (!value) {
    return 0;
  }
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function getSvgSize(svgElement: SVGSVGElement): SvgSize {
  const viewBox = svgElement.getAttribute('viewBox');
  if (viewBox) {
    const [, , width, height] = viewBox.split(/\s+/).map(Number);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }

  const width = parseLength(svgElement.getAttribute('width'));
  const height = parseLength(svgElement.getAttribute('height'));
  if (width > 0 && height > 0) {
    return { width, height };
  }

  try {
    const bbox = svgElement.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      return { width: bbox.width, height: bbox.height };
    }
  } catch (_error) {
    // jsdom and detached SVGs can throw here; fall through to safe default.
  }

  return { width: 800, height: 600 };
}

function createSvgBlob(svgElement: SVGSVGElement): Blob {
  const serializedSvg = new XMLSerializer().serializeToString(svgElement);
  return new Blob([serializedSvg], { type: 'image/svg+xml;charset=utf-8' });
}

function fitSize(size: SvgSize, maxWidth: number, maxHeight: number): SvgSize {
  const scale = Math.min(maxWidth / size.width, maxHeight / size.height, 1);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

export async function svgToPngBlob(
  svgElement: SVGSVGElement,
  options: SvgToPngOptions = {},
): Promise<SvgToPngResult> {
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = options.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logicalSize = fitSize(getSvgSize(svgElement), maxWidth, maxHeight);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(logicalSize.width * dpr);
  canvas.height = Math.ceil(logicalSize.height * dpr);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is not available.');
  }
  context.scale(dpr, dpr);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, logicalSize.width, logicalSize.height);

  const objectUrl = URL.createObjectURL(createSvgBlob(svgElement));

  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      const timer = window.setTimeout(() => {
        reject(new Error('SVG image loading timed out.'));
      }, timeoutMs);

      image.onload = () => {
        window.clearTimeout(timer);
        try {
          context.drawImage(image, 0, 0, logicalSize.width, logicalSize.height);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('Failed to load SVG image.'));
      };
      image.src = objectUrl;
    });

    const fileStream = await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to export PNG.'));
            return;
          }
          resolve(blob);
        }, 'image/png');
      } catch (error) {
        reject(error);
      }
    });

    return { fileStream, fileSize: fileStream.size };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
