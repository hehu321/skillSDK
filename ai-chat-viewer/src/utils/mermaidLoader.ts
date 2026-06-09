interface MermaidRenderResult {
  svg: string;
  bindFunctions?: (element: Element) => void;
}

export interface MermaidApi {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<MermaidRenderResult> | MermaidRenderResult;
}

type MermaidModule = MermaidApi | { default: MermaidApi };

let mermaidPromise: Promise<MermaidApi> | null = null;

function resolveMermaidModule(module: MermaidModule): MermaidApi {
  return 'default' in module ? module.default : module;
}

export function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((module) => {
      const mermaid = resolveMermaidModule(module as MermaidModule);
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}
