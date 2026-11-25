-- Exclusão lógica de propostas: o documento emitido continua imutável, mas pode ser marcado como excluído
-- (deleted_at/deleted_by_user_id). Uma proposta excluída não aceita mais nenhuma alteração.
CREATE OR REPLACE FUNCTION crm_proposal_freeze_header() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted proposal is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'DRAFT' AND
    (to_jsonb(NEW) - ARRAY['status','version','updated_at','accepted_at','declined_at','decline_reason','converted_at','deleted_at','deleted_by_user_id']) IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['status','version','updated_at','accepted_at','declined_at','decline_reason','converted_at','deleted_at','deleted_by_user_id']) THEN
    RAISE EXCEPTION 'Issued proposal document is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status = 'DRAFT' AND NEW.status = 'SENT') OR (OLD.status = 'SENT' AND NEW.status IN ('ACCEPTED','DECLINED')) OR (OLD.status = 'ACCEPTED' AND NEW.status = 'CONVERTED')) THEN
    RAISE EXCEPTION 'Invalid proposal transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
