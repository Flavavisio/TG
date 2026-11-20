ALTER TABLE public.servicos
    ADD COLUMN IF NOT EXISTS materiais_previstos jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.servicos.materiais_previstos IS
    'Previsão das OS independentes [{artigoId,qtdPrevista}]. Os consumos vêm de movimentos_stock.';

CREATE OR REPLACE FUNCTION public.tg_validar_plano_materiais_os()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    artigo jsonb;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.materiais_previstos IS NOT DISTINCT FROM OLD.materiais_previstos THEN
            RETURN NEW;
        END IF;
    ELSIF NEW.materiais_previstos = '[]'::jsonb THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.perfis p
        WHERE p.id = (SELECT auth.uid())
          AND ((p.papel = 'admin' AND p.registo_id = NEW.admin_id)
            OR (p.papel = 'subadmin' AND p.admin_id = NEW.admin_id))
    ) THEN
        RAISE EXCEPTION 'Sem autorização para alterar o plano de materiais da OS.' USING ERRCODE = '42501';
    END IF;

    IF NEW.obra_id IS NOT NULL OR jsonb_typeof(NEW.materiais_previstos) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'O plano de materiais próprio exige uma OS independente.' USING ERRCODE = '23514';
    END IF;

    IF (SELECT count(DISTINCT value->>'artigoId') FROM jsonb_array_elements(NEW.materiais_previstos))
       <> jsonb_array_length(NEW.materiais_previstos) THEN
        RAISE EXCEPTION 'O plano de materiais contém artigos repetidos ou sem identificação.' USING ERRCODE = '23514';
    END IF;

    FOR artigo IN SELECT value FROM jsonb_array_elements(NEW.materiais_previstos) LOOP
        IF jsonb_typeof(artigo->'artigoId') IS DISTINCT FROM 'string'
           OR jsonb_typeof(artigo->'qtdPrevista') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'Artigo ou quantidade inválidos no plano de materiais.' USING ERRCODE = '23514';
        END IF;
        IF (artigo->>'qtdPrevista')::numeric <= 0 OR NOT EXISTS (
            SELECT 1 FROM public.artigos a
            WHERE a.id = artigo->>'artigoId' AND a.admin_id = NEW.admin_id
        ) THEN
            RAISE EXCEPTION 'Artigo ou quantidade inválidos no plano de materiais.' USING ERRCODE = '23514';
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_validar_plano_materiais_os ON public.servicos;
CREATE TRIGGER tg_validar_plano_materiais_os
    BEFORE INSERT OR UPDATE OF materiais_previstos ON public.servicos
    FOR EACH ROW EXECUTE FUNCTION public.tg_validar_plano_materiais_os();
