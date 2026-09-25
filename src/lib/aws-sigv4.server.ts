import { createHash, createHmac } from "node:crypto";

type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

let cachedCredentials: { value: AwsCredentials; expiresAt: number } | null = null;

function hexSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

export async function getAwsCredentials(): Promise<AwsCredentials> {
  if (cachedCredentials && cachedCredentials.expiresAt > Date.now() + 60_000) {
    return cachedCredentials.value;
  }

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    const value = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    };
    cachedCredentials = { value, expiresAt: Date.now() + 5 * 60_000 };
    return value;
  }

  const relative = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  const full = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  const token = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
  const url = full ?? (relative ? `http://169.254.170.2${relative}` : "");
  if (!url) throw new Error("AWS task credentials are unavailable");

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = token;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`AWS task credentials request failed: ${res.status}`);
  const body = (await res.json()) as {
    AccessKeyId: string;
    SecretAccessKey: string;
    Token?: string;
    Expiration?: string;
  };
  const value = {
    accessKeyId: body.AccessKeyId,
    secretAccessKey: body.SecretAccessKey,
    sessionToken: body.Token,
  };
  cachedCredentials = {
    value,
    expiresAt: body.Expiration ? new Date(body.Expiration).getTime() : Date.now() + 10 * 60_000,
  };
  return value;
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalQuery(params: Record<string, string>) {
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${awsEncode(k)}=${awsEncode(v)}`)
    .join("&");
}

function signingKey(secret: string, date: string, region: string, service: string) {
  const kDate = hmac(`AWS4${secret}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export async function signedAwsQuery(
  service: string,
  region: string,
  url: URL,
  params: Record<string, string>,
): Promise<Response> {
  const credentials = await getAwsCredentials();
  const body = canonicalQuery(params);
  const payloadHash = hexSha256(body);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: url.host,
    "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (credentials.sessionToken) headers["x-amz-security-token"] = credentials.sessionToken;

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k].trim()}\n`)
    .join("");
  const canonicalRequest = [
    "POST",
    url.pathname || "/",
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hexSha256(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(
    credentials.secretAccessKey,
    date,
    region,
    service,
  )).update(stringToSign).digest("hex");

  headers.Authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(30_000),
  });
}
