import { getPool } from "./db-admin.server";
import { presignS3Url } from "./s3-presign.server";

const PAGE_SIZE = 1_000;

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "dataset";
}

async function putJson(bucket: string, key: string, value: unknown) {
  const url = await presignS3Url({
    method: "PUT",
    bucket,
    key,
    region: process.env.AWS_REGION ?? "ap-southeast-2",
    expiresSeconds: 900,
  });
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`S3 dataset upload failed (${response.status})`);
}

/** Export one RDS pipeline snapshot to protected S3 without touching any
 * historical trade-data bucket. RDS remains the queryable source of truth. */
export async function exportPipelineDataset(userId: string, snapshotName: string) {
  const bucket = process.env.QUANT_ARTIFACTS_BUCKET;
  if (!bucket) throw new Error("QUANT_ARTIFACTS_BUCKET is not configured");
  const pool = await getPool();
  const { rows: created } = await pool.query<{ id: string }>(
    `INSERT INTO public.pipeline_dataset_exports (user_id, snapshot_name, status, error, row_count, part_count)
     VALUES ($1, $2, 'running', NULL, 0, 0)
     ON CONFLICT (user_id, snapshot_name) DO UPDATE
       SET status='running', error=NULL, row_count=0, part_count=0, updated_at=now()
     RETURNING id`,
    [userId, snapshotName],
  );
  const exportId = created[0].id;
  const prefix = `private/accounts/${userId}/pipeline-datasets/${safeSegment(snapshotName)}/${exportId}`;
  try {
    const { rows: countRows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.trade_intelligence_archive WHERE snapshot_name=$1`,
      [snapshotName],
    );
    const rowCount = Number(countRows[0]?.count ?? 0);
    let offset = 0;
    let partCount = 0;
    while (offset < rowCount) {
      const { rows } = await pool.query<{ row: Record<string, unknown> }>(
        `SELECT row_to_json(t) AS row
           FROM (SELECT * FROM public.trade_intelligence_archive
                 WHERE snapshot_name=$1 ORDER BY id LIMIT $2 OFFSET $3) t`,
        [snapshotName, PAGE_SIZE, offset],
      );
      if (!rows.length) break;
      const jsonl = rows.map((r) => JSON.stringify(r.row)).join("\n") + "\n";
      const key = `${prefix}/part-${String(partCount + 1).padStart(6, "0")}.jsonl`;
      const url = await presignS3Url({ method: "PUT", bucket, key, region: process.env.AWS_REGION ?? "ap-southeast-2", expiresSeconds: 900 });
      const response = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/x-ndjson" },
        body: jsonl,
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`S3 dataset part upload failed (${response.status})`);
      offset += rows.length;
      partCount += 1;
    }
    const manifestKey = `${prefix}/manifest.json`;
    await putJson(bucket, manifestKey, {
      format: "jsonl",
      snapshot_name: snapshotName,
      row_count: rowCount,
      part_count: partCount,
      generated_at: new Date().toISOString(),
      source: "rds.trade_intelligence_archive",
    });
    await pool.query(
      `UPDATE public.pipeline_dataset_exports
       SET status='complete', manifest_s3_key=$2, row_count=$3, part_count=$4, updated_at=now()
       WHERE id=$1`,
      [exportId, manifestKey, rowCount, partCount],
    );
    return { exportId, status: "complete" as const, rowCount, partCount, manifestKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `UPDATE public.pipeline_dataset_exports SET status='failed', error=$2, updated_at=now() WHERE id=$1`,
      [exportId, message.slice(0, 4000)],
    );
    throw error;
  }
}
