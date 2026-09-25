import { signedAwsQuery } from "./aws-sigv4.server";

const REGION = process.env.AWS_REGION ?? "ap-southeast-2";

function queueUrlTarget(queueUrl: string) {
  const u = new URL(queueUrl);
  return new URL(`${u.protocol}//${u.host}/`);
}

function xmlUnescape(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function callSqs(queueUrl: string, action: string, extra: Record<string, string>) {
  const target = queueUrlTarget(queueUrl);
  const response = await signedAwsQuery("sqs", REGION, target, {
    Action: action,
    Version: "2012-11-05",
    QueueUrl: queueUrl,
    ...extra,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`SQS ${action} failed: ${response.status} ${body.slice(0, 500)}`);
  return body;
}

export async function sendSqsMessage(queueUrl: string, body: unknown) {
  const xml = await callSqs(queueUrl, "SendMessage", {
    MessageBody: JSON.stringify(body),
  });
  return xml.match(/<MessageId>([^<]+)<\/MessageId>/)?.[1] ?? null;
}

export async function receiveSqsMessage(queueUrl: string, waitTimeSeconds = 20) {
  const xml = await callSqs(queueUrl, "ReceiveMessage", {
    MaxNumberOfMessages: "1",
    WaitTimeSeconds: String(waitTimeSeconds),
    VisibilityTimeout: "43200",
    AttributeName: "ApproximateReceiveCount",
  });
  const messageMatch = xml.match(/<Message>([\s\S]*?)<\/Message>/);
  if (!messageMatch) return null;
  const message = messageMatch[1];
  const receiptHandle = xmlUnescape(message.match(/<ReceiptHandle>([\s\S]*?)<\/ReceiptHandle>/)?.[1] ?? "");
  const rawBody = xmlUnescape(message.match(/<Body>([\s\S]*?)<\/Body>/)?.[1] ?? "");
  const messageId = xmlUnescape(message.match(/<MessageId>([\s\S]*?)<\/MessageId>/)?.[1] ?? "");
  const receiveCount = Number(message.match(/<ApproximateReceiveCount>([^<]+)<\/ApproximateReceiveCount>/)?.[1] ?? "1");
  if (!receiptHandle || !rawBody) return null;
  return {
    messageId,
    receiptHandle,
    receiveCount,
    body: JSON.parse(rawBody) as unknown,
  };
}

export async function deleteSqsMessage(queueUrl: string, receiptHandle: string) {
  await callSqs(queueUrl, "DeleteMessage", { ReceiptHandle: receiptHandle });
}
