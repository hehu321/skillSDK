const path = require('path');

const BASE_BROWSERS_TARGET = {
  chrome: '49',
  edge: '15',
  firefox: '45',
  safari: '10',
  ios: '10',
};

const WEBPACK_ES5_TARGET = ['web', 'es5'];

const WEBPACK_ES5_OUTPUT_ENVIRONMENT = {
  arrowFunction: false,
  bigIntLiteral: false,
  const: false,
  destructuring: false,
  dynamicImport: false,
  forOf: false,
  module: false,
  optionalChaining: false,
  templateLiteral: false,
};

const TRANSPILE_DEPENDENCIES = [
  '@braintree/sanitize-url',
  '@remix-run/router',
  '@iconify/*',
  '@mermaid-js/*',
  '@upsetjs/*',
  'bail',
  'ccount',
  'character-*',
  'cytoscape',
  'cytoscape-cose-bilkent',
  'cytoscape-fcose',
  'cose-base',
  'dagre-d3-es',
  'd3',
  'd3-*',
  'dayjs',
  'decode-named-character-reference',
  'dompurify',
  'entities',
  'es-toolkit',
  'hast-util-*',
  'hastscript',
  'html-url-attributes',
  'html-void-elements',
  'comma-separated-tokens',
  'i18next',
  'is-plain-obj',
  'internmap',
  'katex',
  'khroma',
  'layout-base',
  'longest-streak',
  'marked',
  'markdown-table',
  'mdast-util-*',
  'mermaid',
  'micromark',
  'micromark-*',
  'parse5',
  'property-information',
  'space-separated-tokens',
  'react-markdown',
  'react-i18next',
  'react-router',
  'react-router-dom',
  'react-syntax-highlighter',
  'remark-breaks',
  'remark-parse',
  'remark-gfm',
  'remark-math',
  'remark-rehype',
  'rehype-katex',
  'rehype-raw',
  'roughjs',
  'stylis',
  'ts-dedent',
  'trough',
  'trim-lines',
  'unified',
  'unist-util-*',
  'vfile',
  'vfile-location',
  'vfile-message',
  'uuid',
  'web-namespaces',
  'zwitch',
];

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

const RESOLVE_ALIAS = {
  '@braintree/sanitize-url$': path.resolve(__dirname, 'node_modules/@braintree/sanitize-url/src/index.ts'),
  'dayjs$': path.resolve(__dirname, 'node_modules/dayjs/esm/index.js'),
  'dayjs/plugin/advancedFormat.js$': path.resolve(__dirname, 'node_modules/dayjs/esm/plugin/advancedFormat/index.js'),
  'dayjs/plugin/customParseFormat.js$': path.resolve(__dirname, 'node_modules/dayjs/esm/plugin/customParseFormat/index.js'),
  'dayjs/plugin/duration.js$': path.resolve(__dirname, 'node_modules/dayjs/esm/plugin/duration/index.js'),
  'dayjs/plugin/isoWeek.js$': path.resolve(__dirname, 'node_modules/dayjs/esm/plugin/isoWeek/index.js'),
  'cytoscape-cose-bilkent$': path.resolve(__dirname, 'src/vendor/cytoscapeCoseBilkentCompat.ts'),
  'cytoscape-fcose$': path.resolve(__dirname, 'src/vendor/cytoscapeFcoseCompat.ts'),
  'parse5/lib/parser/index.js$': path.resolve(__dirname, 'src/vendor/parse5ParserCompat.ts'),
};

function dependencyPatternMatches(pattern, packageName) {
  if (pattern.endsWith('*')) {
    return packageName.startsWith(pattern.slice(0, -1));
  }
  return packageName === pattern;
}

function shouldTranspileDependency(filePath) {
  const packageMatches = [...filePath.matchAll(/[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/g)];

  if (packageMatches.length === 0) {
    return true;
  }

  const packageName = packageMatches[packageMatches.length - 1][1];
  return TRANSPILE_DEPENDENCIES.some((pattern) => dependencyPatternMatches(pattern, packageName));
}

function createEs5Output(output) {
  return {
    ...output,
    environment: {
      ...WEBPACK_ES5_OUTPUT_ENVIRONMENT,
      ...(output.environment || {}),
    },
  };
}

function createBabelRule({ includePolyfills = false } = {}) {
  const presetEnvOptions = {
    bugfixes: true,
    forceAllTransforms: true,
    targets: BASE_BROWSERS_TARGET,
  };
  if (includePolyfills) {
    presetEnvOptions.useBuiltIns = 'usage';
    presetEnvOptions.corejs = '3.44';
  }

  return {
    test: /\.(ts|tsx|js|jsx|mjs)$/,
    exclude: (filePath) => !shouldTranspileDependency(filePath),
    use: {
      loader: 'babel-loader',
      options: {
        presets: [
          ['@babel/preset-env', presetEnvOptions],
          ['@babel/preset-react', { runtime: 'automatic' }],
          '@babel/preset-typescript',
        ],
      },
    },
  };
}

function createStyleLoader(singletonStyleTag) {
  if (!singletonStyleTag) {
    return 'style-loader';
  }
  return {
    loader: 'style-loader',
    options: { insert: 'head', injectType: 'singletonStyleTag' },
  };
}

function createStyleRules({ singletonStyleTag = false } = {}) {
  const styleLoader = createStyleLoader(singletonStyleTag);
  return [
    {
      test: /\.css$/,
      use: [styleLoader, 'css-loader'],
    },
    {
      test: /\.less$/,
      use: [styleLoader, 'css-loader', 'less-loader'],
    },
  ];
}

function createAssetRule({ singletonStyleTag = false, platform = null, product = null } = {}) {
  if (singletonStyleTag) {
    return {
      test: /\.(png|jpe?g|gif|svg|ico|woff|woff2|ttf|eot)$/i,
      type: "asset/inline"
    };
  } else if (platform === 'pc' && product) {
    return {
      test: /\.(png|jpe?g|gif|svg|ico|woff|woff2|ttf|eot)$/i,
      type: "asset",
      generator: {
        filename: '[name].[contenthash][ext]',
        outputPath: `../resources/${product}`,
        publicPath: `welink-static://agentSkills/${product}/`,
      },
    };
  } else {
    return {
      test: /\.(png|jpe?g|gif|svg|ico|woff|woff2|ttf|eot)$/i,
      type: "asset",
      parser: {
        dataUrlCondition: {
          maxSize: 8192,
        },
      },
    };
  } 
}

function createResolveConfig() {
  return {
    extensions: RESOLVE_EXTENSIONS,
    alias: RESOLVE_ALIAS,
  };
}

function createModuleRules({ includePolyfills = false, singletonStyleTag = false, platform = null, product = null } = {}) {
  return [
    createBabelRule({ includePolyfills }),
    ...createStyleRules({ singletonStyleTag }),
    createAssetRule({ singletonStyleTag, platform, product }),
  ];
}

module.exports = {
  createResolveConfig,
  RESOLVE_EXTENSIONS,
  WEBPACK_ES5_TARGET,
  createEs5Output,
  createModuleRules,
};
