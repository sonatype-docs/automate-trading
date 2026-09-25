import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAccessToken, onAuthChange } from "@/lib/auth-client";

type PrivateFile = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  status: "issued" | "complete";
  created_at: string;
};

export const Route = createFileRoute("/files")({
  head: () => ({
    meta: [{ title: "Private Files — Shark Auto-Trader" }],
  }),
  component: FilesPage,
});

function FilesPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [files, setFiles] = useState<PrivateFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function loadFiles() {
    const token = await getAccessToken();
    if (!token) return;
    const response = await fetch("/api/files/list", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Unable to load private files");
    setFiles((await response.json()).files as PrivateFile[]);
  }

  useEffect(() => {
    const unsubscribe = onAuthChange((value) => {
      setSignedIn(value);
      if (value) loadFiles().catch((error) => setMessage(error.message));
    });
    return unsubscribe;
  }, []);

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Please sign in before uploading");
      const headers = { Authorization: `Bearer ${token}` };
      const presign = await fetch("/api/files/presign", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream", sizeBytes: file.size }),
      });
      if (!presign.ok) throw new Error("Unable to create upload authorization");
      const { fileId, uploadUrl } = await presign.json() as { fileId: string; uploadUrl: string };
      const put = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      if (!put.ok) throw new Error("Upload failed");
      const complete = await fetch("/api/files/complete", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      if (!complete.ok) throw new Error("Upload verification failed");
      await loadFiles();
      setMessage("Upload completed and verified.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function download(file: PrivateFile) {
    const token = await getAccessToken();
    if (!token) return;
    const response = await fetch(`/api/files/download?fileId=${encodeURIComponent(file.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      setMessage("Unable to authorize this download");
      return;
    }
    const { downloadUrl } = await response.json() as { downloadUrl: string };
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = file.filename;
    link.click();
  }

  if (!signedIn) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Card><CardHeader><CardTitle>Private files</CardTitle><CardDescription>Sign in to access owner-scoped protected S3 files.</CardDescription></CardHeader><CardContent><Button asChild><Link to="/login">Sign in</Link></Button></CardContent></Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <Card>
        <CardHeader><CardTitle>Private files</CardTitle><CardDescription>Files are uploaded to protected S3 using short-lived presigned URLs. Existing trade objects are never listed here.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <input type="file" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file); event.currentTarget.value = ""; }} className="block w-full text-sm" />
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Your uploads</CardTitle><CardDescription>{files.length} file{files.length === 1 ? "" : "s"}</CardDescription></CardHeader>
        <CardContent>
          {files.length === 0 ? <p className="text-sm text-muted-foreground">No private uploads yet.</p> : <div className="divide-y divide-border">{files.map((file) => <div key={file.id} className="flex items-center justify-between gap-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{file.filename}</p><p className="text-xs text-muted-foreground">{file.status} · {Math.ceil(file.size_bytes / 1024)} KB</p></div><Button size="sm" variant="outline" disabled={file.status !== "complete"} onClick={() => download(file)}>Download</Button></div>)}</div>}
        </CardContent>
      </Card>
    </main>
  );
}
