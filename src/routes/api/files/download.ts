import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyCognitoRequest } from "@/lib/auth-middleware";
import { presignS3Url } from "@/lib/s3-presign.server";

export const Route = createFileRoute("/api/files/download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let auth: Awaited<ReturnType<typeof verifyCognitoRequest>>;
        try { auth = await verifyCognitoRequest(request); }
        catch (error) { return error instanceof Response ? error : Response.json({ error: "Unauthorized" }, { status: 401 }); }
        const fileId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("fileId"));
        if (!fileId.success) return Response.json({ error: "invalid_file_id" }, { status: 400 });
        const bucket = process.env.AWS_FILES_BUCKET ?? process.env.FILES_BUCKET;
        const region = process.env.AWS_REGION ?? "ap-southeast-2";
        if (!bucket) return Response.json({ error: "file_storage_not_configured" }, { status: 503 });
        const { getPool } = await import("@/lib/db-admin.server");
        const { rows } = await (await getPool()).query<{ s3_key: string; filename: string; content_type: string }>(
          `select s3_key, filename, content_type from public.private_files where id = $1 and user_id = $2`,
          [fileId.data, auth.userId],
        );
        if (!rows[0]) return Response.json({ error: "not_found" }, { status: 404 });
        const url = await presignS3Url({ method: "GET", bucket, key: rows[0].s3_key, region });
        return Response.json({ downloadUrl: url, filename: rows[0].filename, contentType: rows[0].content_type, expiresInSeconds: 600 });
      },
    },
  },
});
