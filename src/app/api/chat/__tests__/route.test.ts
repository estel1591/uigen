// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from "vitest";

const { mockStreamText, mockStrReplaceTool, mockFileManagerTool } = vi.hoisted(() => {
  const execute = () => {};
  return {
    mockStreamText: vi.fn(),
    mockStrReplaceTool: { description: "str_replace_editor", parameters: {}, execute },
    mockFileManagerTool: { description: "file_manager", parameters: {}, execute },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve({ get: vi.fn(), set: vi.fn() })),
}));
vi.mock("ai", () => ({
  streamText: mockStreamText,
  appendResponseMessages: vi.fn(() => []),
  convertToCoreMessages: vi.fn((msgs: any[]) => msgs),
}));
vi.mock("@/lib/provider", () => ({
  getLanguageModel: vi.fn(() => ({ modelId: "mock" })),
}));
vi.mock("@/lib/prompts/generation", () => ({
  generationPrompt: "You are a test assistant.",
}));
vi.mock("@/lib/tools/str-replace", () => ({
  buildStrReplaceTool: vi.fn(() => mockStrReplaceTool),
}));
vi.mock("@/lib/tools/file-manager", () => ({
  buildFileManagerTool: vi.fn(() => mockFileManagerTool),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { project: { update: vi.fn() } },
}));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(() => null),
}));
vi.mock("@/lib/file-system", () => ({
  VirtualFileSystem: vi.fn(() => ({
    deserializeFromNodes: vi.fn(),
    serialize: vi.fn(() => ({})),
  })),
}));

import { POST } from "@/app/api/chat/route";

function makeRequest(messages: any[], files: Record<string, any> = {}, projectId?: string) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, files, projectId }),
  });
}

const userMsg = (content: string) => ({ role: "user", content });
const assistantMsg = (content: string) => ({ role: "assistant", content });

beforeEach(() => {
  vi.clearAllMocks();
  mockStreamText.mockReturnValue({ toDataStreamResponse: () => new Response("ok") });
});

// --- System prompt caching ---

describe("system prompt cache_control", () => {
  test("inserts system prompt at index 0 with ephemeral cacheControl", async () => {
    await POST(makeRequest([userMsg("hello")]));

    const { messages } = mockStreamText.mock.calls[0][0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  test("system prompt contains the generationPrompt text", async () => {
    await POST(makeRequest([userMsg("hello")]));

    const { messages } = mockStreamText.mock.calls[0][0];
    expect(messages[0].content).toBe("You are a test assistant.");
  });
});

// --- Conversation history caching ---

describe("conversation history cache_control", () => {
  test("does not add cacheControl to the only user message on first turn", async () => {
    await POST(makeRequest([userMsg("first message")]));

    const { messages } = mockStreamText.mock.calls[0][0];
    // length === 2 (system + user), no history caching
    expect(messages[1].providerOptions).toBeUndefined();
  });

  test("does not add cacheControl to current user message when history exists", async () => {
    await POST(makeRequest([userMsg("msg1"), assistantMsg("resp1"), userMsg("msg2")]));

    const { messages } = mockStreamText.mock.calls[0][0];
    const currentUserMsg = messages[messages.length - 1];
    expect(currentUserMsg.role).toBe("user");
    expect(currentUserMsg.providerOptions).toBeUndefined();
  });

  test("adds cacheControl to second-to-last message when history exists", async () => {
    await POST(makeRequest([userMsg("msg1"), assistantMsg("resp1"), userMsg("msg2")]));

    const { messages } = mockStreamText.mock.calls[0][0];
    // [system, user1, assistant1, user2] → cache on messages[2] = assistant1
    const cached = messages[messages.length - 2];
    expect(cached.role).toBe("assistant");
    expect(cached.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  test("does not mutate the original message object — uses a spread copy", async () => {
    const original = assistantMsg("resp1");
    await POST(makeRequest([userMsg("msg1"), original, userMsg("msg2")]));

    expect(original.providerOptions).toBeUndefined();
  });

  test("caches the correct message in a longer conversation", async () => {
    const history = [
      userMsg("msg1"),
      assistantMsg("resp1"),
      userMsg("msg2"),
      assistantMsg("resp2"),
      userMsg("msg3"),
    ];
    await POST(makeRequest(history));

    const { messages } = mockStreamText.mock.calls[0][0];
    // [system, u1, a1, u2, a2, u3] → cache on messages[4] = a2
    const cached = messages[messages.length - 2];
    expect(cached.content).toBe("resp2");
    expect(cached.providerOptions).toEqual({
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
  });

  test("no messages beyond system get cacheControl when request has no prior history", async () => {
    await POST(makeRequest([userMsg("only message")]));

    const { messages } = mockStreamText.mock.calls[0][0];
    const nonSystemWithCache = messages
      .slice(1)
      .filter((m: any) => m.providerOptions !== undefined);
    expect(nonSystemWithCache).toHaveLength(0);
  });
});

// --- Tool definitions passed to streamText ---
// Tool-level cache_control is injected by fetchWithToolCache in provider.ts,
// not here — so tools are passed through as-is from their builders.

describe("tool definitions passed to streamText", () => {
  test("both tools are registered", async () => {
    await POST(makeRequest([userMsg("hello")]));

    const { tools } = mockStreamText.mock.calls[0][0];
    expect(tools).toHaveProperty("str_replace_editor");
    expect(tools).toHaveProperty("file_manager");
  });

  test("tools are passed without experimental_providerMetadata (cache injected by fetch interceptor)", async () => {
    await POST(makeRequest([userMsg("hello")]));

    const { tools } = mockStreamText.mock.calls[0][0];
    expect(tools.str_replace_editor.experimental_providerMetadata).toBeUndefined();
    expect(tools.file_manager.experimental_providerMetadata).toBeUndefined();
  });

  test("tool objects retain their original properties from the builders", async () => {
    await POST(makeRequest([userMsg("hello")]));

    const { tools } = mockStreamText.mock.calls[0][0];
    expect(tools.str_replace_editor).toBe(mockStrReplaceTool);
    expect(tools.file_manager).toBe(mockFileManagerTool);
  });
});
