import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RouteLoadError({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className="min-h-[60vh] grid place-items-center p-6">
      <Card className="w-full max-w-2xl border-destructive/40">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" /> Page data failed to load
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground break-words">{message}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => reset()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry page
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload application
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
