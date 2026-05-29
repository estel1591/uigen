# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Style

Use comments sparingly. Only comment complex code.

## Commands

```bash
npm run setup        # First-time setup: install deps, generate Prisma client, run migrations
npm run dev          # Start dev server (Turbopack) at http://localhost:3000
npm run dev:daemon   # Run dev server in background (logs → logs.txt)
npm run build        # Production build
npm run lint         # ESLint via Next.js
npm run test         # Vitest unit tests (jsdom environment)
npm run db:reset     # Reset SQLite database (destructive)
```

**Environment**: Copy `.env.example` to `.env.local` and set `ANTHROPIC_API_KEY`. Without it, the app falls back to a `MockLanguageModel` that returns canned responses.

## Architecture

UIGen is a Next.js 15 (App Router) full-stack application. Users describe React components in a chat interface; Claude generates code via tool calls that mutate an in-memory virtual file system, with a live iframe preview updated on every change.

### Request Flow

1. User sends a message → **Chat Context** (`src/lib/contexts/chat-context.tsx`) via `useAIChat()` (Vercel AI SDK)
2. `POST /api/chat` receives messages + serialized VFS state
3. API route reconstructs the VFS and calls Claude (`claude-sonnet-4-5`) via `streamText()` with two tools
4. Claude calls **`str_replace_editor`** (view/create/str_replace/insert) and **`file_manager`** (rename/delete) defined in `src/lib/tools/`
5. Tool results update the **VirtualFileSystem** (Map-based in-memory tree, `src/lib/file-system.ts`)
6. On stream completion, if authenticated, the project (messages + VFS JSON) is persisted to Prisma (SQLite)
7. **PreviewFrame** (`src/components/preview/PreviewFrame.tsx`) picks up VFS changes, runs client-side Babel transpilation (`src/lib/transform/jsx-transformer.ts`), generates an import map (esm.sh CDN for React 19 + libraries), and injects everything into a sandboxed `<iframe srcdoc=...>`

### Key Modules

| Path | Role |
|------|------|
| `src/app/api/chat/route.ts` | AI endpoint; reconstructs VFS, streams Claude response with tools, persists to DB |
| `src/lib/file-system.ts` | `VirtualFileSystem` class — all file operations and serialization |
| `src/lib/contexts/chat-context.tsx` | Client-side AI chat state; applies tool results to VFS |
| `src/lib/contexts/file-system-context.tsx` | Provides VFS state/mutations to the component tree |
| `src/lib/transform/jsx-transformer.ts` | Babel JSX transpilation + import map generation for iframe preview |
| `src/lib/prompts/generation.tsx` | System prompt for component generation (cached with Anthropic ephemeral cache) |
| `src/lib/tools/` | Tool definitions for `str_replace_editor` and `file_manager` |
| `src/actions/` | Server Actions for project CRUD |
| `src/components/preview/PreviewFrame.tsx` | Sandboxed iframe live preview |
| `src/components/editor/` | Monaco editor + file tree |

### Data Model

Schema is defined in `prisma/schema.prisma` — refer to it whenever you need to understand the structure of data stored in the database.

```
User { id, email, password }
  └── Project { id, name, messages (JSON), data (JSON) }
```

`messages` stores the full chat history; `data` stores the serialized VirtualFileSystem. Anonymous sessions are tracked via localStorage (`src/lib/anon-work-tracker.ts`).

### Path Aliases

`@/*` maps to `./src/*` (configured in `tsconfig.json` and recognized by the Babel transformer for preview).

### AI Provider

`src/lib/provider.ts` selects between `@ai-sdk/anthropic` (when `ANTHROPIC_API_KEY` is set) and a mock model. The API route uses prompt caching (`experimental_providerMetadata: { anthropic: { cacheControl: { type: 'ephemeral' } } }`) on the system prompt to reduce latency and cost.

### Batches API

`src/lib/batch.ts` wraps the Anthropic [Message Batches API](https://docs.anthropic.com/en/api/creating-message-batches). Use it — **not** `streamText` — when:

- The user wants to generate **multiple components at once** (e.g. a full component library from a list of descriptions)
- Real-time streaming is **not required** (results arrive asynchronously, within 24 h)
- Cost matters — batch requests are **50% cheaper** than regular API calls

**Endpoints:**
- `POST /api/batch` — `{ descriptions: string[] }` → creates a batch job, returns `{ id, anthropicId, status, counts }`
- `GET /api/batch?id=<id>` — polls status; when `status === "ended"` includes `results[]` with generated `code` per request

**DB model:** `Batch` (see `prisma/schema.prisma`) stores `anthropicId`, `userId`, `status`, and the original `requests` JSON so batch jobs survive server restarts.

**Do NOT use batches for:** single-component generation in the main chat flow — that uses streaming tool calls and needs real-time feedback.
