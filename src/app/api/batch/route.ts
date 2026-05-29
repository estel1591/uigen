import { getSession } from "@/lib/auth";
import { createComponentBatch, getBatchStatus, getBatchResults } from "@/lib/batch";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { descriptions }: { descriptions: string[] } = await req.json();
  if (!Array.isArray(descriptions) || descriptions.length === 0) {
    return Response.json({ error: "'descriptions' array is required" }, { status: 400 });
  }

  const requests = descriptions.map((desc, i) => ({ customId: `req-${i}`, description: desc }));
  const batch = await createComponentBatch(requests);

  const record = await prisma.batch.create({
    data: {
      anthropicId: batch.id,
      userId: session.userId,
      status: batch.processingStatus,
      requests: JSON.stringify(descriptions),
    },
  });

  return Response.json({
    id: record.id,
    anthropicId: batch.id,
    status: batch.processingStatus,
    counts: batch.requestCounts,
  });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "'id' parameter is required" }, { status: 400 });

  const record = await prisma.batch.findFirst({
    where: { id, userId: session.userId },
  });
  if (!record) return Response.json({ error: "Batch not found" }, { status: 404 });

  const status = await getBatchStatus(record.anthropicId);

  if (status.processingStatus === "ended") {
    if (record.status !== "ended") {
      await prisma.batch.update({ where: { id }, data: { status: "ended" } });
    }
    const results = await getBatchResults(record.anthropicId);
    return Response.json({
      id,
      anthropicId: record.anthropicId,
      status: "ended",
      counts: status.requestCounts,
      results,
    });
  }

  return Response.json({
    id,
    anthropicId: record.anthropicId,
    status: status.processingStatus,
    counts: status.requestCounts,
  });
}
