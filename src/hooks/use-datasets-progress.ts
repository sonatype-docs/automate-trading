import { useEffect, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { queryTrades } from "@/lib/trade-intelligence.functions";
import type { TradeRecord } from "@/lib/trade-intelligence/types";

// Module-level cache keyed by dataset name. Survives route navigation within
// the SPA session (cleared on hard reload / Resync).
const cache = new Map<string, TradeRecord[]>();

export function clearDatasetsCache(datasets?: string[]) {
  if (!datasets) cache.clear();
  else for (const d of datasets) cache.delete(d);
}

export interface DatasetProgress {
  loaded: number;
  done: boolean;
  cached?: boolean;
  status: "queued" | "fetching" | "cached" | "done" | "error";
  pageSize: number;
  rowsPerChunk: number;
  chunksPerWave: number;
  currentWave: number;
  wavesFetched: number;
  chunksFetched: number;
  lastBatchRows: number;
  startedAt?: number;
  updatedAt: number;
  error?: string;
}

export interface DatasetsProgressResult {
  data: Record<string, TradeRecord[]>;
  progress: Record<string, DatasetProgress>;
  isLoading: boolean;
  totalLoaded: number;
  error?: Error;
}

const PAGE = 8000;
const ROWS_PER_CHUNK = 1000;
const CHUNKS_PER_WAVE = PAGE / ROWS_PER_CHUNK;

function makeProgress(
  patch: Partial<DatasetProgress> & Pick<DatasetProgress, "loaded" | "done" | "status">,
): DatasetProgress {
  return {
    pageSize: PAGE,
    rowsPerChunk: ROWS_PER_CHUNK,
    chunksPerWave: CHUNKS_PER_WAVE,
    currentWave: 0,
    wavesFetched: 0,
    chunksFetched: 0,
    lastBatchRows: 0,
    updatedAt: Date.now(),
    ...patch,
  };
}

export function useDatasetsProgress(datasets: string[], resyncKey = 0): DatasetsProgressResult {
  const queryFn = useServerFn(queryTrades);
  const [data, setData] = useState<Record<string, TradeRecord[]>>({});
  const [progress, setProgress] = useState<Record<string, DatasetProgress>>({});
  const [error, setError] = useState<Error | undefined>();
  const key = datasets.join("|") + "::" + resyncKey;
  const runRef = useRef(0);

  useEffect(() => {
    const runId = ++runRef.current;
    let cancelled = false;
    setError(undefined);

    // Seed from cache immediately
    const seedData: Record<string, TradeRecord[]> = {};
    const seedProg: Record<string, DatasetProgress> = {};
    for (const ds of datasets) {
      if (cache.has(ds)) {
        const rows = cache.get(ds)!;
        seedData[ds] = rows;
        seedProg[ds] = makeProgress({
          loaded: rows.length,
          done: true,
          cached: true,
          status: "cached",
          wavesFetched: Math.ceil(rows.length / PAGE),
          chunksFetched: Math.ceil(rows.length / ROWS_PER_CHUNK),
          lastBatchRows: rows.length,
        });
      } else {
        seedProg[ds] = makeProgress({ loaded: 0, done: false, status: "queued" });
      }
    }
    setData(seedData);
    setProgress(seedProg);

    (async () => {
      for (const ds of datasets) {
        if (cancelled || runRef.current !== runId) return;
        if (cache.has(ds)) continue;
        const acc: TradeRecord[] = [];
        let offset = 0;
        let wave = 0;
        const startedAt = Date.now();
        try {
          while (!cancelled && runRef.current === runId) {
            wave += 1;
            setProgress((p) => ({
              ...p,
              [ds]: {
                ...(p[ds] ?? makeProgress({ loaded: acc.length, done: false, status: "queued" })),
                loaded: acc.length,
                done: false,
                cached: false,
                status: "fetching",
                currentWave: wave,
                startedAt,
                updatedAt: Date.now(),
              },
            }));
            const res = await queryFn({
              data: { limit: PAGE, offset, orderBy: "entry_time", order: "asc", dataset: ds },
            });
            const rows = res.rows as TradeRecord[];
            acc.push(...rows);
            const fetchedChunksThisWave = Math.ceil(rows.length / ROWS_PER_CHUNK);
            setProgress((p) => ({
              ...p,
              [ds]: {
                ...(p[ds] ?? makeProgress({ loaded: 0, done: false, status: "fetching" })),
                loaded: acc.length,
                done: false,
                cached: false,
                status: "fetching",
                currentWave: wave,
                wavesFetched: wave,
                chunksFetched: Math.max(0, (wave - 1) * CHUNKS_PER_WAVE) + fetchedChunksThisWave,
                lastBatchRows: rows.length,
                startedAt,
                updatedAt: Date.now(),
              },
            }));
            if (rows.length < PAGE) break;
            offset += PAGE;
          }
          if (cancelled || runRef.current !== runId) return;
          cache.set(ds, acc);
          setData((d) => ({ ...d, [ds]: acc }));
          setProgress((p) => ({
            ...p,
            [ds]: {
              ...(p[ds] ?? makeProgress({ loaded: acc.length, done: true, status: "done" })),
              loaded: acc.length,
              done: true,
              cached: false,
              status: "done",
              updatedAt: Date.now(),
            },
          }));
        } catch (e) {
          if (!cancelled && runRef.current === runId) {
            const err = e as Error;
            setError(err);
            setProgress((p) => ({
              ...p,
              [ds]: {
                ...(p[ds] ?? makeProgress({ loaded: acc.length, done: false, status: "error" })),
                loaded: acc.length,
                done: true,
                status: "error",
                error: err.message,
                updatedAt: Date.now(),
              },
            }));
          }
          return;
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const isLoading = datasets.some((ds) => !progress[ds]?.done);
  const totalLoaded = datasets.reduce((sum, ds) => sum + (progress[ds]?.loaded ?? 0), 0);
  return { data, progress, isLoading, totalLoaded, error };
}
