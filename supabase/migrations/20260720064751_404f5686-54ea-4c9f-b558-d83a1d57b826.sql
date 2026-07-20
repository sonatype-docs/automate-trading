CREATE TABLE public.liquidity_lab_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.liquidity_lab_presets TO authenticated;
GRANT ALL ON public.liquidity_lab_presets TO service_role;

ALTER TABLE public.liquidity_lab_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own liquidity lab presets"
  ON public.liquidity_lab_presets
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_liquidity_lab_presets_updated_at
  BEFORE UPDATE ON public.liquidity_lab_presets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_liquidity_lab_presets_user ON public.liquidity_lab_presets(user_id, updated_at DESC);