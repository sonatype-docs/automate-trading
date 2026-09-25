import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyCognitoRequest } from "@/lib/auth-middleware";
import { presignS3Url } from "@/lib/s3-presign.server";

const Input = z.object({
  filename: z.string().trim().min(1).max(180),
  contentType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
  checksum: z.string().trim().max(128).optional(),
});

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "upload.bin";
}

export const Route = createFileRoute("/api/files/presign")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let auth: Awaited<ReturnType<typeof verifyCognitoRequest>>;
        try { auth = await verifyCognitoRequest(request); }
        catch (error) { return error instanceof Response ? error : Response.json({ error: "Unauthorized" }, { status: 401 }); }
        let input: z.infer<typeof Input>;
        try { input = Input.parse(await request.json()); }
        catch { return Response.json({ error: "invalid_file" }, { status: 400 }); }
        const bucket = process.env.AWS_FILES_BUCKET ?? process.env.FILES_BUCKET;
        const region = process.env.AWS_REGION ?? "ap-southeast-2";
        if (!bucket) return Response.json({ error: "file_storage_not_configured" }, { status: 503 });
        const id = crypto.randomUUID();
        const key = `private/accounts/${auth.userId}/uploads/${id}-${safeFilename(input.filename)}`;
        const { getPool } = await import("@/lib/db-admin.server");
        const pool = await getPool();
        await pool.query(
          `insert into public.private_files (id, user_id, s3_key, filename, content_type, size_bytes, checksum)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [id, auth.userId, key, input.filename, input.contentType, input.sizeBytes, input.checksum ?? null],
        );
        const uploadUrl = await presignS3Url({ method: "PUT", bucket, key, region });
        return Response.json({ fileId: id, key, uploadUrl, expiresInSeconds: 600 });
      },
    },
  },
});
