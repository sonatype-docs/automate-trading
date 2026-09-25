import { createHash, createHmac } from "node:crypto";
import { getAwsCredentials } from "./aws-sigv4.server";

function encode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(key: string) {
  return `/${key.split("/").map(encode).join("/")}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function signingKey(secret: string, date: string, region: string) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

export async function presignS3Url({
  method,
  bucket,
  key,
  region,
  expiresSeconds = 600,
}: {
  method: "GET" | "PUT";
  bucket: string;
  key: string;
  region: string;
  expiresSeconds?: number;
}) {
  const credentials = await getAwsCredentials();
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const path = canonicalPath(key);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`;
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${credentials.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.max(60, Math.min(900, expiresSeconds))),
    "X-Amz-SignedHeaders": "host",
  };
  if (credentials.sessionToken) params["X-Amz-Security-Token"] = credentials.sessionToken;
  const canonicalQuery = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .join("&");
  const canonicalRequest = [method, path, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(credentials.secretAccessKey, date, region))
    .update(stringToSign).digest("hex");
  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
