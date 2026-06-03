# AGENTS.md - ai-chat-viewer

## Project Shape
This directory is a React 18 + TypeScript + Webpack front-end subproject inside the Skill SDK repository. It is not the Android/iOS/Harmony native SDK root.

Main responsibilities:
- WeAgent CUI chat page
- Skill CUI page and library export
- Create/edit/detail/select/switch assistant pages
- HWH5EXT/Pedestal host bridge integration
- Local browser mock and OpenCode bridge for development
- UMD library bundles and standalone page bundles

## Commands
Install dependencies:
`npm install`

Run main dev server:
`npm run dev`

Notes:
- Opens Webpack dev server on port `3000`
- Proxies `/api` to `http://localhost:8082`
- Proxies `/ws` to `ws://localhost:8082`

Run standalone create-assistant page:
`npm run serve:create-assistant-page`

Notes:
- Uses port `3102`

Run tests:
`npm test`

Run lint:
`npm run lint`

Build main web bundle:
`npm run build`

Build PC main bundle:
`npm run build:pc`

Build UMD library:
`npm run build:lib`

Build Skill CUI UMD library:
`npm run build:skill-cui-lib`

Build standalone create-assistant page:
`npm run build:create-assistant-page`

Build PC component package:
`npm run build:pc-components:pc`

## Development Rules
- Do not change public bridge contracts casually. `src/types`, `src/types/bridge`, `src/utils/hwext.ts`, and `src/protocol/StreamAssembler.ts` define the effective wire/API shape.
- Treat `src/hooks/useChatSession.ts` as high risk. Add or update tests for streaming, snapshots, permissions, questions, history pagination, listener cleanup, and stop behavior when modifying it.
- Keep page routes hash-router compatible. Main routes live in `src/routes/AppRouter.tsx`; create-assistant standalone routes live in `src/routes/CreateAssistantPageRouter.tsx`.
- Preserve library exports in `src/lib/index.ts` and `src/lib/skillCUI.ts`; demos may consume built `dist/lib` output.
- Be careful with PC/mobile branching. `isPcMiniApp()` controls Pedestal vs HWH5EXT, layout, toast, app info, and history sidebar behavior.
- Local browser mocks are development aids only. Do not let mock-only behavior become the production contract.
- Markdown rendering allows raw HTML via `rehypeRaw`; security-sensitive changes must consider sanitization or trusted-content assumptions.
- Keep i18n keys in both `src/i18n/resources/zh.ts` and `src/i18n/resources/en.ts`.

## Testing Expectations
For chat/session changes, cover:
- interleaved streaming message IDs
- `text.delta` / `text.done`
- `snapshot` and `streaming` recovery
- permission ask/reply
- question answer submission
- history pagination and listener cleanup

For assistant creation changes, cover:
- validation rules
- avatar upload validation
- PC/mobile layout branches
- qrcode flow where applicable
- create/update/qrcode JSAPI calls

For bundle/export changes, verify:
- `npm run build`
- `npm run build:lib`
- `npm run build:skill-cui-lib`
- relevant demo build if exports changed

## Known Context To Confirm Before Future Work
- Current runtime PC detection returns `false`; confirm intended PC behavior before changing PC-specific code.
- Requirements, tests, and implementation differ on create-assistant minimum text length and custom provider support; confirm product intent first.
- No dependency lockfile is committed in this directory because `package-lock.json` is ignored.
