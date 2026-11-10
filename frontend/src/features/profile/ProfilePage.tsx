import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, CircleAlert, RotateCcw, Trash2, UserRound } from 'lucide-react';
import { api, ApiError, type AvatarUpload, type Company, type User } from '../../api/client';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import { UserAvatar } from '../../components/UserAvatar';
import { putAvatar } from './upload-avatar';
import './profile.css';

type Selection = { file: File; key: string; preview: string };
type Ready = { key: string; id: string; expiresAt: string };

export function ProfilePage({ user, companies }: { user: User; companies?: Company[] }) {
  const client = useQueryClient();
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [base, setBase] = useState(user);
  const [name, setName] = useState(user.name);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [phase, setPhase] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [conflict, setConflict] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const uploadRef = useRef<{ key: string; session: AvatarUpload } | null>(null);
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); client.clear(); window.location.assign('/Clientes'); }, onError: (cause) => { setError(cause instanceof Error ? cause.message : 'Não foi possível sair. Tente novamente.'); } });

  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); }, [companyId]);
  useEffect(() => { if (companies && !companies.some((item) => item.id === companyId)) setCompanyId(companies[0]?.id ?? ''); }, [companies, companyId]);
  useEffect(() => { return () => { abortRef.current?.abort(); }; }, []);
  const preview = selection?.preview;
  useEffect(() => { return () => { if (preview) URL.revokeObjectURL(preview); }; }, [preview]);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 200;
  const changed = trimmed !== base.name || !!selection || (removePhoto && !!base.avatarId);
  const busy = !!phase;

  function clearPhoto() {
    abortRef.current?.abort();
    uploadRef.current = null;
    setSelection(null);
    setReady(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!(['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) || file.size === 0 || file.size > 5 * 1024 * 1024) {
      setError('Escolha uma imagem JPEG, PNG ou WebP de até 5 MiB.');
      event.target.value = '';
      return;
    }
    clearPhoto();
    setSelection({ file, key: crypto.randomUUID(), preview: URL.createObjectURL(file) });
    setRemovePhoto(false);
    setError(''); setSuccess(''); setConflict(false); setUncertain(false);
  }

  function cancel() {
    if (busy) return;
    clearPhoto(); setName(base.name); setRemovePhoto(false);
    setError(''); setSuccess(''); setConflict(false); setUncertain(false);
  }

  async function acceptSaved(saved: User) {
    client.setQueryData(['me'], saved);
    await client.invalidateQueries({ queryKey: ['managed-users'] });
    await client.invalidateQueries({ queryKey: ['profile-avatar-access', saved.id] });
    setBase(saved); setName(saved.name); clearPhoto(); setRemovePhoto(false);
    setError(''); setConflict(false); setUncertain(false); setSuccess('Alterações salvas.');
  }

  async function loadCurrent() {
    try {
      const current = await api.me();
      client.setQueryData(['me'], current);
      clearPhoto(); setBase(current); setName(current.name); setRemovePhoto(false);
      setConflict(false); setUncertain(false); setError(''); setSuccess('Dados atuais carregados.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os dados atuais.'); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || !changed || !valid || conflict || uncertain) return;
    busyRef.current = true; setError(''); setSuccess('');
    let wantedAvatar: string | null = removePhoto ? null : base.avatarId;
    let patchStarted = false;
    try {
      if (selection) {
        const mimeType = selection.file.type as 'image/jpeg' | 'image/png' | 'image/webp';
        if (ready?.key === selection.key && new Date(ready.expiresAt).getTime() > Date.now() + 5000) {
          wantedAvatar = ready.id;
        } else {
          setPhase('Preparando envio da foto…');
          let session = uploadRef.current?.key === selection.key ? uploadRef.current.session : null;
          if (session?.upload && new Date(session.upload.expiresAt).getTime() <= Date.now()) session = null;
          if (!session) {
            session = await api.beginAvatarUpload({ mimeType, sizeBytes: selection.file.size }, selection.key);
            uploadRef.current = { key: selection.key, session };
          }
          if (session.file.status !== 'READY') {
            if (session.upload) {
              setPhase('Enviando foto…'); setProgress(0);
              const controller = new AbortController(); abortRef.current = controller;
              await putAvatar(selection.file, session.upload, setProgress, controller.signal);
              abortRef.current = null;
            }
            setPhase('Processando foto…');
          }
          const completed = await api.completeAvatarUpload(session.file.id);
          if (completed.file.status !== 'READY' || !completed.expiresAt) throw new Error('A foto não ficou pronta. Escolha outra imagem.');
          wantedAvatar = completed.file.id;
          setReady({ key: selection.key, id: wantedAvatar, expiresAt: completed.expiresAt });
        }
      }
      const input: { expectedVersion: number; name?: string; avatarId?: string | null } = { expectedVersion: base.profileVersion };
      if (trimmed !== base.name) input.name = trimmed;
      if (selection || (removePhoto && base.avatarId)) input.avatarId = wantedAvatar;
      setPhase('Salvando alterações…'); patchStarted = true;
      await acceptSaved(await api.updateProfile(input));
    } catch (cause) {
      if (patchStarted && cause instanceof ApiError && cause.status === 409) {
        setConflict(true); setError('O perfil foi alterado em outra sessão. Seu rascunho foi preservado. Carregue os dados atuais para editar novamente.');
      } else if (patchStarted && (cause instanceof ApiError && cause.status === 0)) {
        try {
          const current = await api.me();
          const match = current.profileVersion > base.profileVersion && current.name === (trimmed !== base.name ? trimmed : base.name) && current.avatarId === wantedAvatar;
          if (match) await acceptSaved(current);
          else { setUncertain(true); setError('Não foi possível confirmar se as alterações foram salvas. Confira os dados atuais antes de tentar novamente.'); }
        } catch { setUncertain(true); setError('Não foi possível confirmar o resultado. Confira o perfil atual antes de tentar novamente.'); }
      } else {
        if (!patchStarted && cause instanceof ApiError && (cause.status === 400 || cause.status === 410)) {
          uploadRef.current = null; setReady(null);
          if (selection) setSelection({ ...selection, key: crypto.randomUUID() });
        }
        setError(cause instanceof Error ? cause.message : 'Não foi possível salvar as alterações.');
      }
    } finally { setPhase(''); busyRef.current = false; abortRef.current = null; }
  }

  return <WorkspaceLayout user={user} companies={companies} companyId={companyId} onCompanyChange={setCompanyId} onLogout={() => logout.mutate()} loggingOut={logout.isPending} onboarding={!companies?.length}>
    <main id="workspace-main" className="profile-main">
      <header className="profile-heading"><span>CONTA PESSOAL</span><h1>Meu perfil</h1><p>Atualize seu nome e sua foto. O e-mail da conta é apenas informativo.</p></header>
      <form className="profile-card" onSubmit={(event) => { void save(event); }}>
        <section className="profile-photo"><div className="profile-photo__image">{selection ? <img src={selection.preview} alt="Prévia da foto selecionada" /> : removePhoto ? <span aria-label="Sem foto"><UserRound size={34} /></span> : <UserAvatar user={user} />}</div><div><h2>Foto do perfil</h2><p>JPEG, PNG ou WebP, até 5 MiB. A foto será enviada ao salvar.</p><div className="profile-photo__actions"><input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={choose} hidden aria-label="Escolher foto" /><button type="button" className="button" disabled={busy} onClick={() => inputRef.current?.click()}><Camera size={16} />{selection || base.avatarId ? 'Substituir foto' : 'Escolher foto'}</button>{(selection || (base.avatarId && !removePhoto)) && <button type="button" className="button" disabled={busy} onClick={() => { clearPhoto(); setRemovePhoto(true); setError(''); }}><Trash2 size={16} />Remover foto</button>}</div></div></section>
        <section className="profile-fields"><h2>Dados pessoais</h2><label htmlFor="profile-name">Nome</label><input id="profile-name" value={name} maxLength={200} required aria-invalid={!valid} aria-describedby={!valid ? 'profile-name-error' : undefined} disabled={busy} onChange={(event) => { setName(event.target.value); setSuccess(''); }} />{!valid && <small id="profile-name-error">Informe um nome de 1 a 200 caracteres.</small>}<label htmlFor="profile-email">E-mail</label><input id="profile-email" type="email" value={base.email} readOnly aria-readonly="true" /><small>O e-mail não pode ser alterado nesta página.</small></section>
        {phase && <p className="profile-message" role="status">{phase}{phase === 'Enviando foto…' ? ` ${progress}%` : ''}</p>}
        {error && <div className="profile-message profile-message--error" role="alert"><CircleAlert size={17} />{error}{(conflict || uncertain) && <button type="button" onClick={() => { void loadCurrent(); }}>Carregar estado atual</button>}</div>}
        {success && <p className="profile-message profile-message--success" role="status">{success}</p>}
        <footer className="profile-actions"><button type="button" className="button" disabled={busy || !changed} onClick={cancel}><RotateCcw size={16} />Cancelar alterações</button><button type="submit" className="button button--primary" disabled={busy || !changed || !valid || conflict || uncertain}>Salvar alterações</button></footer>
      </form>
    </main>
  </WorkspaceLayout>;
}
