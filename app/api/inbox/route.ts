import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";


export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId") || "";
    const limit = Math.min(Number(searchParams.get("limit") || 5), 20);

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "userId required" },
        { status: 400 }
      );
    }

    const items = await prisma.proactiveInbox.findMany({
      where: {
        userId,
        status: "PENDING",
        OR: [
          { scheduledFor: null },
          { scheduledFor: { lte: new Date() } }
        ],
      },
      orderBy: [
        { priority: "asc" },
        { createdAt: "asc" }
      ],
      take: limit,
    });

    if (items.length) {
      const ids = items.map((it) => it.id);
      await prisma.proactiveInbox.updateMany({
        where: { id: { in: ids } },
        data: { status: "SENT", sentAt: new Date() },
      });
    }

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { ok: false, error: "server_error" },
      { status: 500 }
    );
  }
}
