const ANTHROPIC_API = "https://api.anthropic.com/v1";
const MODEL = "claude-haiku-4-5-20251001";

function getHeaders() {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key || key === "your-api-key-here") throw new Error("ANTHROPIC_API_KEY is not set");
  return {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "message-batches-2024-09-24",
    "content-type": "application/json",
  };
}

export interface BatchRequest {
  customId: string;
  description: string;
}

export interface BatchStatus {
  id: string;
  processingStatus: "in_progress" | "ended" | "canceling" | "canceled";
  requestCounts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
}

export interface BatchResultItem {
  customId: string;
  type: "succeeded" | "errored" | "canceled" | "expired";
  code?: string;
  error?: string;
}

const BATCH_SYSTEM_PROMPT =
  "You are a React component generator. Respond with ONLY the complete JSX for /App.jsx — " +
  "no explanation, no markdown fences, just raw JSX. Export a default React component. " +
  "Style with Tailwind CSS only. Never use hardcoded inline styles.";

export async function createComponentBatch(requests: BatchRequest[]): Promise<BatchStatus> {
  const body = {
    requests: requests.map(({ customId, description }) => ({
      custom_id: customId,
      params: {
        model: MODEL,
        max_tokens: 4096,
        system: BATCH_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Create a React component: ${description}` }],
      },
    })),
  };

  const res = await fetch(`${ANTHROPIC_API}/messages/batches`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Batch creation failed: ${await res.text()}`);
  return normalizeBatchStatus(await res.json());
}

export async function getBatchStatus(anthropicId: string): Promise<BatchStatus> {
  const res = await fetch(`${ANTHROPIC_API}/messages/batches/${anthropicId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Batch status fetch failed: ${await res.text()}`);
  return normalizeBatchStatus(await res.json());
}

export async function getBatchResults(anthropicId: string): Promise<BatchResultItem[]> {
  const res = await fetch(`${ANTHROPIC_API}/messages/batches/${anthropicId}/results`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Batch results fetch failed: ${await res.text()}`);

  const text = await res.text();
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const item = JSON.parse(line);
      if (item.result.type === "succeeded") {
        return {
          customId: item.custom_id,
          type: "succeeded" as const,
          code: item.result.message.content[0]?.text ?? "",
        };
      }
      return {
        customId: item.custom_id,
        type: item.result.type as "errored" | "canceled" | "expired",
        error: item.result.error?.message,
      };
    });
}

function normalizeBatchStatus(data: any): BatchStatus {
  return {
    id: data.id,
    processingStatus: data.processing_status,
    requestCounts: {
      processing: data.request_counts?.processing ?? 0,
      succeeded: data.request_counts?.succeeded ?? 0,
      errored: data.request_counts?.errored ?? 0,
      canceled: data.request_counts?.canceled ?? 0,
      expired: data.request_counts?.expired ?? 0,
    },
  };
}
