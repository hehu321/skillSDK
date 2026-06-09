import React, {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import arrowUpIcon from '../imgs/arrow_up_icon.svg';
import warnIcon from '../imgs/warn_icon.svg';
import { MarkdownRuntimeConfigContext } from './MarkdownRuntimeConfigContext';
import { loadMermaid } from '../utils/mermaidLoader';
import { svgToPngBlob } from '../utils/svgExport';
import { isPcFileDownloadError } from '../utils/pcFileDownload';
import { showToast } from '../utils/toast';
import { reportFlowTelemetry } from '../utils/telemetry';
import '../styles/MermaidBlock.less';

interface MermaidBlockProps {
  code: string;
}

interface CachedSvg {
  svg: string;
}

interface SvgDimensions {
  width: number;
  height: number;
}

interface FitInput {
  containerWidth: number;
  maxPreviewHeight: number;
  svgWidth: number;
  svgHeight: number;
}

interface FitState extends SvgDimensions {
  scale: number;
  previewHeight: number;
}

type MermaidRenderErrorStage = 'load_or_render' | 'empty_svg';
type MermaidExportErrorStage = 'missing_download_method'
  | 'missing_svg'
  | 'svg_to_png_or_download'
  | 'download_unsupported';

const MERMAID_THEME = 'default';
const MAX_SVG_CACHE_SIZE = 50;
const MIN_PREVIEW_HEIGHT = 160;
const MAX_PREVIEW_HEIGHT = 500;
const svgCache = new Map<string, CachedSvg>();

function getCacheKey(code: string): string {
  return `${MERMAID_THEME}\n${code}`;
}

function getCachedSvg(code: string): string | null {
  const key = getCacheKey(code);
  const cached = svgCache.get(key);
  if (!cached) {
    return null;
  }
  svgCache.delete(key);
  svgCache.set(key, cached);
  return cached.svg;
}

function setCachedSvg(code: string, svg: string): void {
  const key = getCacheKey(code);
  if (svgCache.has(key)) {
    svgCache.delete(key);
  }
  svgCache.set(key, { svg });
  while (svgCache.size > MAX_SVG_CACHE_SIZE) {
    const oldestKey = svgCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    svgCache.delete(oldestKey);
  }
}

function sanitizeMermaidId(value: string): string {
  const safeId = value.replace(/[^A-Za-z0-9_-]/g, '');
  return safeId || 'chart';
}

function calculateMermaidPreviewScale({
  containerWidth,
  maxPreviewHeight,
  svgWidth,
  svgHeight,
}: FitInput): number {
  if (containerWidth <= 0 || maxPreviewHeight <= 0 || svgWidth <= 0 || svgHeight <= 0) {
    return 1;
  }
  return Math.min(containerWidth / svgWidth, maxPreviewHeight / svgHeight, 1);
}

function parseSvgDimension(value: string | null): number {
  if (!value) return 0;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function readSvgDimensions(svg: SVGSVGElement): SvgDimensions {
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const [, , width, height] = viewBox.split(/\s+/).map(Number);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }

  const width = parseSvgDimension(svg.getAttribute('width'));
  const height = parseSvgDimension(svg.getAttribute('height'));
  if (width > 0 && height > 0) {
    return { width, height };
  }

  try {
    const bbox = svg.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      return { width: bbox.width, height: bbox.height };
    }
  } catch (_error) {
    // Detached SVGs and jsdom can throw. The fallback keeps layout stable.
  }

  return { width: 800, height: 600 };
}

function getMaxPreviewHeight(): number {
  if (typeof window === 'undefined' || !window.innerHeight) {
    return MAX_PREVIEW_HEIGHT;
  }
  return Math.min(MAX_PREVIEW_HEIGHT, Math.round(window.innerHeight * 0.6));
}

function trimTelemetryText(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

function resolveTelemetryError(error: unknown): { errorCode?: string; errorMessage?: string } {
  if (!error || typeof error !== 'object') {
    return {
      errorMessage: trimTelemetryText(typeof error === 'string' ? error : undefined),
    };
  }

  const record = error as Record<string, unknown>;
  const code = record.errorCode ?? record.code;
  return {
    errorCode: code === null || code === undefined ? undefined : String(code),
    errorMessage: trimTelemetryText(
      typeof record.errorMessage === 'string'
        ? record.errorMessage
        : typeof record.message === 'string'
          ? record.message
          : undefined,
    ),
  };
}

export const MermaidBlock: React.FC<MermaidBlockProps> = ({ code }) => {
  const { t } = useTranslation();
  const runtimeConfig = useContext(MarkdownRuntimeConfigContext);
  const reactId = useId();
  const diagramId = useMemo(
    () => `mermaid-chart-${sanitizeMermaidId(reactId)}`,
    [reactId],
  );
  const previewRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<HTMLDivElement | null>(null);
  const renderTokenRef = useRef(0);
  const [collapsed, setCollapsed] = useState(false);
  const [svg, setSvg] = useState<string | null>(() => getCachedSvg(code));
  const [failed, setFailed] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fitState, setFitState] = useState<FitState | null>(null);
  const isStreaming = Boolean(runtimeConfig.isStreaming);
  const isPc = Boolean(runtimeConfig.isPc);

  const reportRenderError = useCallback((stage: MermaidRenderErrorStage, error?: unknown) => {
    void reportFlowTelemetry('flow_mermaid_render_error', 'Mermaid 图表渲染错误', {
      type: 'error',
      diagramId,
      stage,
      isStreaming,
      isPc,
      codeLength: code.length,
      ...resolveTelemetryError(error),
    });
  }, [code.length, diagramId, isPc, isStreaming]);

  const reportExportError = useCallback((stage: MermaidExportErrorStage, error?: unknown) => {
    void reportFlowTelemetry('flow_mermaid_export_error', 'Mermaid 图片导出错误', {
      type: 'error',
      diagramId,
      stage,
      isPc,
      codeLength: code.length,
      ...resolveTelemetryError(error),
    });
  }, [code.length, diagramId, isPc]);

  useEffect(() => {
    if (isStreaming) {
      setRendering(false);
      setFailed(false);
      return;
    }

    const cachedSvg = getCachedSvg(code);
    if (cachedSvg) {
      setSvg(cachedSvg);
      setFailed(false);
      setRendering(false);
      return;
    }

    const token = renderTokenRef.current + 1;
    renderTokenRef.current = token;
    setRendering(true);
    setFailed(false);
    setSvg(null);

    void loadMermaid()
      .then((mermaid) => mermaid.render(diagramId, code))
      .then((result) => {
        if (renderTokenRef.current !== token) {
          return;
        }
        const rawSvg = (result as { svg?: unknown }).svg;
        const renderedSvg = typeof rawSvg === 'string' ? rawSvg : '';
        if (!renderedSvg.trim()) {
          reportRenderError('empty_svg', new Error('Mermaid render returned empty svg.'));
          setFailed(true);
          setSvg(null);
          return;
        }
        setCachedSvg(code, renderedSvg);
        setSvg(renderedSvg);
        setFailed(false);
      })
      .catch((error) => {
        if (renderTokenRef.current !== token) {
          return;
        }
        reportRenderError('load_or_render', error);
        setFailed(true);
        setSvg(null);
      })
      .finally(() => {
        if (renderTokenRef.current === token) {
          setRendering(false);
        }
      });
  }, [code, diagramId, isStreaming, reportRenderError]);

  const updateFit = useCallback(() => {
    const previewElement = previewRef.current;
    const svgElement = svgRef.current?.querySelector('svg');
    if (!previewElement || !svgElement) {
      setFitState(null);
      return;
    }

    const dimensions = readSvgDimensions(svgElement as SVGSVGElement);
    const maxPreviewHeight = getMaxPreviewHeight();
    const containerWidth = previewElement.clientWidth || dimensions.width;
    const scale = calculateMermaidPreviewScale({
      containerWidth,
      maxPreviewHeight,
      svgWidth: dimensions.width,
      svgHeight: dimensions.height,
    });
    setFitState({
      ...dimensions,
      scale,
      previewHeight: Math.max(MIN_PREVIEW_HEIGHT, Math.ceil(dimensions.height * scale)),
    });
  }, []);

  useLayoutEffect(() => {
    if (!svg || collapsed) {
      return undefined;
    }
    updateFit();

    const previewElement = previewRef.current;
    if (typeof ResizeObserver !== 'undefined' && previewElement) {
      const observer = new ResizeObserver(() => updateFit());
      observer.observe(previewElement);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateFit);
    return () => window.removeEventListener('resize', updateFit);
  }, [collapsed, svg, updateFit]);

  const handleExport = useCallback(async () => {
    if (exporting) {
      return;
    }
    if (typeof runtimeConfig.downloadImage !== 'function') {
      reportExportError('missing_download_method', new Error('Mermaid downloadImage is not available.'));
      showToast(t('mermaid.exportUnsupported'));
      return;
    }

    const svgElement = svgRef.current?.querySelector('svg') as SVGSVGElement | null;
    if (!svgElement) {
      reportExportError('missing_svg', new Error('Mermaid SVG element is not available.'));
      showToast(t('mermaid.exportFailed'));
      return;
    }

    setExporting(true);
    try {
      let fileStream: Blob;
      let fileSize: number;
      try {
        const result = await svgToPngBlob(svgElement);
        fileStream = result.fileStream;
        fileSize = result.fileSize;
      } catch (error) {
        reportExportError('svg_to_png_or_download', error);
        showToast(t('mermaid.exportFailed'));
        return;
      }

      await runtimeConfig.downloadImage({
        fileStream,
        fileSize,
        filename: `${diagramId}.png`,
        mimeType: 'image/png',
        diagramId,
      });
    } catch (error) {
      if (isPcFileDownloadError(error) && error.code === 'unsupported') {
        reportExportError('download_unsupported', error);
        showToast(t('mermaid.exportUnsupported'));
      } else {
        reportExportError('svg_to_png_or_download', error);
        showToast(t('mermaid.exportFailed'));
      }
    } finally {
      setExporting(false);
    }
  }, [diagramId, exporting, reportExportError, runtimeConfig, t]);

  const shouldShowExport = isPc && Boolean(svg) && !failed && !isStreaming;
  const previewStyle = fitState
    ? { minHeight: MIN_PREVIEW_HEIGHT, height: fitState.previewHeight }
    : { minHeight: MIN_PREVIEW_HEIGHT };
  const svgStyle = fitState
    ? {
      width: fitState.width,
      height: fitState.height,
      transform: `scale(${fitState.scale})`,
    }
    : undefined;

  return (
    <div className={`mermaid-block${collapsed ? ' mermaid-block--collapsed' : ''}`}>
      <div className="mermaid-block__header">
        <button
          className="mermaid-block__toggle"
          type="button"
          aria-label={collapsed ? t('codeBlock.expand') : t('codeBlock.collapse')}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          <span className="mermaid-block__lang">mermaid</span>
          <img
            className={[
              'mermaid-block__chevron-icon',
              collapsed ? 'is-collapsed' : '',
            ].filter(Boolean).join(' ')}
            src={arrowUpIcon}
            alt=""
            aria-hidden="true"
            draggable="false"
          />
        </button>
        {shouldShowExport ? (
          <button
            className="mermaid-block__export-btn"
            type="button"
            disabled={exporting}
            onClick={handleExport}
            aria-label={t('mermaid.exportImage')}
          >
            {t('mermaid.exportImage')}
          </button>
        ) : null}
      </div>
      {!collapsed ? (
        <div className="mermaid-block__preview" ref={previewRef} style={previewStyle}>
          {isStreaming || rendering ? (
            <div className="mermaid-block__loading">
              <span className="mermaid-block__loading-dot" />
              <span className="mermaid-block__loading-dot" />
              <span className="mermaid-block__loading-dot" />
              <span className="mermaid-block__loading-text">{t('mermaid.rendering')}</span>
            </div>
          ) : null}
          {!isStreaming && !rendering && failed ? (
            <div className="mermaid-block__failed">
              <img src={warnIcon} alt="" aria-hidden="true" draggable="false" />
              <span>{t('mermaid.renderFailed')}</span>
            </div>
          ) : null}
          {!isStreaming && !rendering && svg ? (
            <div
              className="mermaid-block__svg"
              ref={svgRef}
              style={svgStyle}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
