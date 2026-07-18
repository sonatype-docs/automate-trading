import { useEffect, useState, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { queryTrades } from "@/lib/trade-intelligence.functions";
import type { TradeRecord } from "@/lib/trade-intelligence/types";

// Module-level cache keyed by dataset name. Survives route navigation within
// the SPA session (cleared on hard reload / Resync).
const cache = new Map<string, TradeRecord[]>();
const partialCache = new Map<string, TradeRecord[]>();

export function clearDatasetsCache(datasets?: string[]) {
  if (!datasets) cache.clear();
  else for (const d of datasets) cache.delete(d);
}

export interface DatasetProgress {
  loaded: number;
  done: boolean;
  cached?: boolean;
  status: "queued" | "fetching" | "retrying" | "cached" | "done" | "error";
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

const PAGE = 1000;
const ROWS_PER_CHUNK = 1000;
const CHUNKS_PER_WAVE = 4;

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

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
        const partialRows = partialCache.get(ds) ?? [];
        if (partialRows.length) seedData[ds] = partialRows;
        seedProg[ds] = makeProgress({
          loaded: partialRows.length,
          done: false,
          cached: false,
          status: "queued",
          wavesFetched: Math.floor(partialRows.length / (ROWS_PER_CHUNK * CHUNKS_PER_WAVE)),
          chunksFetched: Math.floor(partialRows.length / ROWS_PER_CHUNK),
          lastBatchRows: 0,
        });
      }
    }
    setData(seedData);
    setProgress(seedProg);

    (async () => {
      for (const ds of datasets) {
        if (cancelled || runRef.current !== runId) return;
        if (cache.has(ds)) continue;
        const acc: TradeRecord[] = partialCache.get(ds)?.slice() ?? [];
        let offset = acc.length;
        let wave = 0;
        let done = false;
        let pageSize = PAGE;
        let chunksPerWave = CHUNKS_PER_WAVE;
        let chunksFetched = Math.floor(acc.length / ROWS_PER_CHUNK);
        let retryCount = 0;
        const startedAt = Date.now();
        try {
          while (!done && !cancelled && runRef.current === runId) {
            wave += 1;
            setProgress((p) => ({
              ...p,
              [ds]: {
                ...(p[ds] ?? makeProgress({ loaded: acc.length, done: false, status: "queued" })),
                loaded: acc.length,
                done: false,
                cached: false,
                status: "fetching",
                pageSize,
                rowsPerChunk: pageSize,
                chunksPerWave,
                currentWave: wave,
                startedAt,
                updatedAt: Date.now(),
              },
            }));
            const plans = Array.from({ length: chunksPerWave }, (_, i) => ({
              index: i,
              offset: offset + i * pageSize,
              limit: pageSize,
            }));
            const results = await Promise.allSettled(
              plans.map(async (plan) => {
                const res = await queryFn({
                  data: {
                    limit: plan.limit,
                    offset: plan.offset,
                    orderBy: "entry_time",
                    order: "asc",
                    dataset: ds,
                    projection: "research",
                  },
                });
                return { ...plan, rows: res.rows as TradeRecord[] };
              }),
            );

            let waveLoaded = 0;
            let successfulChunks = 0;
            let firstError: Error | undefined;
            for (let i = 0; i < results.length; i++) {
              const result = results[i];
              const plan = plans[i];
              if (result.status === "rejected") {
                firstError = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
                break;
              }
              const rows = result.value.rows;
              acc.push(...rows);
              waveLoaded += rows.length;
              successfulChunks += 1;
              chunksFetched += 1;
              offset += rows.length;
              partialCache.set(ds, acc.slice());
              setData((d) => ({ ...d, [ds]: acc.slice() }));
              setProgress((p) => ({
                ...p,
                [ds]: {
                  ...(p[ds] ?? makeProgress({ loaded: acc.length, done: false, status: "fetching" })),
                  loaded: acc.length,
                  done: false,
                  cached: false,
                  status: "fetching",
                  pageSize,
                  rowsPerChunk: plan.limit,
                  chunksPerWave,
                  currentWave: wave,
                  wavesFetched: wave - 1,
                  chunksFetched,
                  lastBatchRows: rows.length,
                  startedAt,
                  updatedAt: Date.now(),
                },
              }));
              if (rows.length < plan.limit) {
                done = true;
                break;
              }
            }

            if (firstError) {
              retryCount += 1;
              setError(firstError);
              pageSize = Math.max(100, Math.floor(pageSize / 2));
              chunksPerWave = 1;
              const delayMs = Math.min(30_000, 1500 * retryCount);
              setProgress((p) => ({
                ...p,
                [ds]: {
                  ...(p[ds] ?? makeProgress({ loaded: acc.length, done: false, status: "retrying" })),
                  loaded: acc.length,
                  done: false,
                  cached: false,
                  status: "retrying",
                  pageSize,
                  rowsPerChunk: pageSize,
                  chunksPerWave,
                  currentWave: wave,
                  wavesFetched: Math.max(0, wave - 1),
                  chunksFetched,
                  lastBatchRows: waveLoaded,
                  startedAt,
                  updatedAt: Date.now(),
                  error: `${firstError.message} Retrying from row ${offset.toLocaleString()} in ${Math.round(delayMs / 1000)}s.`,
                },
              }));
              await wait(delayMs);
              continue;
            }

            retryCount = 0;
            setError(undefined);
            if (pageSize < PAGE) pageSize = Math.min(PAGE, pageSize * 2);
            chunksPerWave = pageSize >= PAGE ? CHUNKS_PER_WAVE : 1;
            setProgress((p) => ({
              ...p,
              [ds]: {
                ...(p[ds] ?? makeProgress({ loaded: 0, done: false, status: "fetching" })),
                loaded: acc.length,
                done: false,
                cached: false,
                status: "fetching",
                pageSize,
                rowsPerChunk: pageSize,
                chunksPerWave,
                currentWave: wave,
                wavesFetched: wave,
                chunksFetched,
                lastBatchRows: waveLoaded,
                startedAt,
                updatedAt: Date.now(),
              },
            }));
            if (successfulChunks === 0 && waveLoaded === 0) done = true;
          }
          if (cancelled || runRef.current !== runId) return;
          cache.set(ds, acc);
          partialCache.delete(ds);
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
            partialCache.set(ds, acc.slice());
            setProgress((p) => ({
              ...p,
              [ds]: {
                ...(p[ds] ?? makeProgress({ loaded: acc.length, done: false, status: "error" })),
                loaded: acc.length,
                done: false,
                status: "error",
                error: `${err.message} Resume will continue from row ${acc.length.toLocaleString()}.`,
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
