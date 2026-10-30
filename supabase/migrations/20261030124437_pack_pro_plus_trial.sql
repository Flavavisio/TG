-- O pedido conserva a capacidade escolhida até à confirmação por email.
ALTER TABLE public.pedidos_trial
  ADD COLUMN IF NOT EXISTS pack_escalao text,
  ADD COLUMN IF NOT EXISTS pack_blocos integer NOT NULL DEFAULT 0;

ALTER TABLE public.pedidos_trial
  ADD CONSTRAINT pedidos_trial_pack_capacidade CHECK (
    pack_escalao IS NULL OR (
      pack_escalao IN ('5', '10', '25', '50') AND
      pack_blocos >= 0 AND pack_blocos <= 19 AND
      pack_escalao::integer + pack_blocos * 5 <= 100
    )
  );
