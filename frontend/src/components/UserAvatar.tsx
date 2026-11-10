import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type User } from '../api/client';
import { initials } from '../utils/format';

export function UserAvatar({ user, className = '' }: { user: User; className?: string }) {
  const client = useQueryClient();
  const key = ['profile-avatar-access', user.id, user.avatarId] as const;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [retried, setRetried] = useState(false);
  const access = useQuery({ queryKey: key, queryFn: api.avatarAccess, enabled: Boolean(user.avatarId), staleTime: 0, refetchOnMount: 'always', retry: false });
  const url = access.data && access.data.avatarId === user.avatarId ? access.data.url : null;
  useEffect(() => {
    if (!url || !access.data) return;
    const delay = new Date(access.data.expiresAt).getTime() - Date.now() - 5000;
    if (delay <= 0) return;
    const timer = window.setTimeout(() => { void client.invalidateQueries({ queryKey: key }); }, delay);
    return () => window.clearTimeout(timer);
  }, [access.data, client, url, user.id, user.avatarId]);
  useEffect(() => { setFailedUrl(null); setRetried(false); }, [user.id, user.avatarId]);
  const imageVisible = Boolean(url && url !== failedUrl);
  return <span className={className} aria-label={`Foto de ${user.name}`}>
    {imageVisible ? <img src={url!} alt="" onError={() => {
      setFailedUrl(url);
      if (!retried) { setRetried(true); void client.invalidateQueries({ queryKey: key }); }
    }} /> : initials(user.name)}
  </span>;
}
