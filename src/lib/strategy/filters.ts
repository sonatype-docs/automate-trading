// Client-safe filter config + Zod schema. Imported by both the UI and server code.
import { z } from "zod";

export const FiltersZod = z
  .object({
    enabled: z.boolean().optional(),
    htf: z
      .object({
        daily_ema_enabled: z.boolean().optional(),
        daily_ema_len: z.number().int().min(2).max(400).optional(),
        prev_day_close_enabled: z.boolean().optional(),
        weekly_open_enabled: z.boolean().optional(),
      })
      .optional(),
    quality: z
      .object({
        zone_size_enabled: z.boolean().optional(),
        zone_size_min: z.number().nonnegative().optional(),
        zone_size_max: z.number().nonnegative().optional(),
        zone_size_unit: z.enum(["usd", "pct"]).optional(),
        atr_enabled: z.boolean().optional(),
        atr_len: z.number().int().min(2).max(200).optional(),
        atr_min: z.number().nonnegative().optional(),
        atr_max: z.number().nonnegative().optional(),
        break_strength_enabled: z.boolean().optional(),
        break_strength_pct: z.number().nonnegative().max(500).optional(),
        break_body_enabled: z.boolean().optional(),
        break_body_pct: z.number().nonnegative().max(100).optional(),
        break_timing_enabled: z.boolean().optional(),
        break_timing_hours: z.number().nonnegative().max(24).optional(),
      })
      .optional(),
  })
  .optional();

export type FilterConfig = z.infer<typeof FiltersZod>;

export const DEFAULT_FILTERS: NonNullable<FilterConfig> = {
  enabled: false,
  htf: {
    daily_ema_enabled: false,
    daily_ema_len: 20,
    prev_day_close_enabled: false,
    weekly_open_enabled: false,
  },
  quality: {
    zone_size_enabled: false,
    zone_size_min: 0,
    zone_size_max: 0,
    zone_size_unit: "usd",
    atr_enabled: false,
    atr_len: 14,
    atr_min: 0,
    atr_max: 0,
    break_strength_enabled: false,
    break_strength_pct: 25,
    break_body_enabled: false,
    break_body_pct: 50,
    break_timing_enabled: false,
    break_timing_hours: 6,
  },
};

/** True when any actual filter is turned on (master gate + at least one child). */
export function filtersActive(cfg: FilterConfig | undefined): boolean {
  if (!cfg?.enabled) return false;
  const h = cfg.htf ?? {};
  const q = cfg.quality ?? {};
  return Boolean(
    h.daily_ema_enabled ||
      h.prev_day_close_enabled ||
      h.weekly_open_enabled ||
      q.zone_size_enabled ||
      q.atr_enabled ||
      q.break_strength_enabled ||
      q.break_body_enabled ||
      q.break_timing_enabled,
  );
}

/** True if any filter that needs daily klines is turned on. */
export function needsDailyBias(cfg: FilterConfig | undefined): boolean {
  if (!cfg?.enabled) return false;
  const h = cfg.htf ?? {};
  const q = cfg.quality ?? {};
  return Boolean(
    h.daily_ema_enabled ||
      h.prev_day_close_enabled ||
      h.weekly_open_enabled ||
      q.atr_enabled,
  );
}
