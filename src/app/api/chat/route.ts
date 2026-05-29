import type { FileNode } from "@/lib/file-system";
import { VirtualFileSystem } from "@/lib/file-system";
import { streamText, appendResponseMessages, convertToCoreMessages } from "ai";
import { buildStrReplaceTool } from "@/lib/tools/str-replace";
import { buildFileManagerTool } from "@/lib/tools/file-manager";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getLanguageModel } from "@/lib/provider";
import { generationPrompt } from "@/lib/prompts/generation";

export async function POST(req: Request) {
  const {
    messages,
    files,
    projectId,
  }: { messages: any[]; files: Record<string, FileNode>; projectId?: string } =
    await req.json();

  // Convert UI messages to CoreMessages first — streamText would do this
  // internally via convertToCoreMessages, which strips providerOptions.
  // By converting explicitly we can safely attach providerOptions before passing.
  const coreMessages = convertToCoreMessages(messages);

  // Cache conversation history up to (but not including) the current user turn
  if (coreMessages.length > 1) {
    const lastHistoryIdx = coreMessages.length - 2;
    coreMessages[lastHistoryIdx] = {
      ...coreMessages[lastHistoryIdx],
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    };
  }

  const allMessages = [
    {
      role: "system" as const,
      content: generationPrompt,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    },
    ...coreMessages,
  ];

  // Reconstruct the VirtualFileSystem from serialized data
  const fileSystem = new VirtualFileSystem();
  fileSystem.deserializeFromNodes(files);

  const model = getLanguageModel();
  // Use fewer steps for mock provider to prevent repetition
  const isMockProvider = !process.env.ANTHROPIC_API_KEY;
  const result = streamText({
    model,
    messages: allMessages,
    maxTokens: 10_000,
    maxSteps: isMockProvider ? 4 : 40,
    onError: (err: any) => {
      console.error(err);
    },
    tools: {
      str_replace_editor: buildStrReplaceTool(fileSystem),
      file_manager: buildFileManagerTool(fileSystem),
    },
    onFinish: async ({ response }) => {
      // Save to project if projectId is provided and user is authenticated
      if (projectId) {
        try {
          // Check if user is authenticated
          const session = await getSession();
          if (!session) {
            console.error("User not authenticated, cannot save project");
            return;
          }

          // Get the messages from the response
          const responseMessages = response.messages || [];
          // Combine original messages with response messages
          const allMessages = appendResponseMessages({
            messages: [...coreMessages],
            responseMessages,
          });

          await prisma.project.update({
            where: {
              id: projectId,
              userId: session.userId,
            },
            data: {
              messages: JSON.stringify(allMessages),
              data: JSON.stringify(fileSystem.serialize()),
            },
          });
        } catch (error) {
          console.error("Failed to save project data:", error);
        }
      }
    },
  });

  return result.toDataStreamResponse();
}

export const maxDuration = 120;
