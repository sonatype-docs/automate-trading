import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyCognitoRequest } from "@/lib/auth-middleware";
import { presignS3Url } from "@/lib/s3-presign.server";

export const Route = createFileRoute("/api/files/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let auth: Awaited<ReturnType<typeof verifyCognitoRequest>>;
        try { auth = await verifyCognitoRequest(request); }
        catch (error) { return error instanceof Response ? error : Response.json({ error: "Unauthorized" }, { status: 401 }); }
        let fileId: string;
        try { fileId = z.object({ fileId: z.string().uuid() }).parse(await request.json()).fileId; }
        catch { return Response.json({ error: "invalid_file_id" }, { status: 400 }); }
        const bucket = process.env.AWS_FILES_BUCKET ?? process.env.FILES_BUCKET;
        const region = process.env.AWS_REGION ?? "ap-southeast-2";
        if (!bucket) return Response.json({ error: "file_storage_not_configured" }, { status: 503 });
        const { getPool } = await import("@/lib/db-admin.server");
        const pool = await getPool();
        const { rows } = await pool.query<{ s3_key: string }>(
          `select s3_key from public.private_files where id = $1 and user_id = $2`,
          [fileId, auth.userId],
        );
        if (!rows[0]) return Response.json({ error: "not_found" }, { status: 404 });
        const headUrl = await presignS3Url({ method: "HEAD", bucket, key: rows[0].s3_key, region, expiresSeconds: 60 });
        const head = await fetch(headUrl, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
        if (!head.ok) return Response.json({ error: "object_not_uploaded" }, { status: 409 });
        await pool.query(
          `update public.private_files set status = 'complete' where id = $1 and user_id = $2`,
          [fileId, auth.userId],
        );
        return Response.json({ ok: true, fileId, status: "complete" });
      },
    },
  },
});
