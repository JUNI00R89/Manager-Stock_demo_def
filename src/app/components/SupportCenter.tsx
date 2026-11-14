import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Clock3, MessageCircle, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../utils/notifications';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Textarea } from './ui/textarea';
import {
  getOwnerSupportCase,
  getOwnerSupportMessages,
  getPlatformSupportCases,
  getPlatformSupportMessages,
  sendOwnerSupportMessage,
  sendPlatformSupportMessage,
  updatePlatformSupportCase,
  type SupportCaseRecord,
  type SupportMessageRecord,
} from '../services/dataService';

type SupportMode = 'owner' | 'platform';
const statusLabels: Record<SupportCaseRecord['status'], string> = {
  open: 'Abierto',
  in_review: 'En revisión',
  awaiting_business: 'Pendiente del negocio',
  resolved: 'Resuelto',
  closed: 'Cerrado',
};
const timeLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
};

export function SupportCenter({ mode, onChanged }: { mode: SupportMode; onChanged?: () => void }) {
  const [cases, setCases] = useState<SupportCaseRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<SupportMessageRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const selectedCase = useMemo(() => cases.find(item => item.id === selectedId) ?? null, [cases, selectedId]);

  const refreshCases = useCallback(async () => {
    if (mode === 'platform') {
      const list = await getPlatformSupportCases();
      setCases(list);
      setSelectedId(current => (list.some(item => item.id === current) ? current : (list[0]?.id ?? '')));
    } else {
      const item = await getOwnerSupportCase();
      const list = item ? [item] : [];
      setCases(list);
      setSelectedId(list[0]?.id ?? '');
    }
  }, [mode]);

  const refreshMessages = useCallback(
    async (caseId: string) => {
      if (!caseId) {
        setMessages([]);
        return;
      }
      setLoadingMessages(true);
      try {
        const list = mode === 'platform' ? await getPlatformSupportMessages(caseId) : await getOwnerSupportMessages();
        setMessages(list);
      } catch (error) {
        toastError(error, 'No se pudo cargar la conversación.');
      } finally {
        setLoadingMessages(false);
      }
    },
    [mode],
  );

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        await refreshCases();
      } catch (error) {
        if (active) toastError(error, 'No se pudo cargar soporte.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshCases]);

  useEffect(() => {
    void refreshMessages(selectedId);
  }, [selectedId, refreshMessages]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshCases().catch(() => undefined);
      if (selectedId) void refreshMessages(selectedId);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [refreshCases, refreshMessages, selectedId]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      if (mode === 'platform') {
        if (!selectedId) throw new Error('Selecciona un caso de soporte.');
        await sendPlatformSupportMessage(selectedId, message);
      } else {
        if (!selectedId) throw new Error('No existe un caso de soporte activo.');
        await sendOwnerSupportMessage(message);
      }
      setDraft('');
      await refreshMessages(selectedId);
      await refreshCases();
      onChanged?.();
      toast.success('Mensaje enviado.');
    } catch (error) {
      toastError(error, 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (status: SupportCaseRecord['status']) => {
    if (!selectedCase) return;
    try {
      await updatePlatformSupportCase(selectedCase.id, status);
      toast.success(status === 'resolved' ? 'Caso resuelto y negocio reactivado.' : 'Estado del caso actualizado.');
      await refreshCases();
      onChanged?.();
    } catch (error) {
      toastError(error, 'No se pudo actualizar el caso.');
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--brand-primary)]">
            {mode === 'platform' ? 'Administración global' : 'Ayuda y revisión'}
          </p>
          <h2 className="mt-1 text-xl font-bold">
            {mode === 'platform' ? 'Comunicaciones y suspensiones' : 'Comunicación con soporte'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Los mensajes quedan registrados en el servidor y asociados a su caso.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void refreshCases();
            if (selectedId) void refreshMessages(selectedId);
          }}
          disabled={loading}
          className="rounded-xl"
        >
          <RefreshCw size={15} className={`mr-2 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(220px,.8fr)_minmax(0,1.7fr)]">
        {mode === 'platform' && (
          <Card className="overflow-hidden rounded-2xl border-border/70">
            <div className="border-b border-border px-4 py-3">
              <h3 className="font-semibold">Casos</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {cases.filter(item => !['resolved', 'closed'].includes(item.status)).length} pendientes
              </p>
            </div>
            <div className="max-h-[470px] overflow-y-auto divide-y divide-border/60">
              {loading ? (
                <p className="p-6 text-sm text-muted-foreground">Cargando casos…</p>
              ) : cases.length ? (
                cases.map(item => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full p-4 text-left transition hover:bg-muted/30 ${item.id === selectedId ? 'bg-[var(--brand-soft)]' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm">{item.businessName || item.businessId}</p>
                      {item.unreadCount > 0 && (
                        <span className="rounded-full bg-[var(--brand-primary)] px-2 py-0.5 text-xs font-bold text-white">
                          {item.unreadCount}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.reason}</p>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Clock3 size={12} />
                      {statusLabels[item.status]} · {timeLabel(item.updatedAt)}
                    </div>
                  </button>
                ))
              ) : (
                <p className="p-6 text-sm text-muted-foreground">No hay casos de soporte.</p>
              )}
            </div>
          </Card>
        )}
        <Card className="flex min-h-[440px] flex-col overflow-hidden rounded-2xl border-border/70">
          {selectedCase ? (
            <>
              <header className="border-b border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <MessageCircle size={18} className="text-[var(--brand-primary)]" />
                      <h3 className="font-semibold">{selectedCase.businessName || 'Caso de soporte'}</h3>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Caso {selectedCase.id} · {selectedCase.reason}
                    </p>
                    {selectedCase.description && (
                      <p className="mt-2 text-sm text-muted-foreground">{selectedCase.description}</p>
                    )}
                  </div>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">
                    {statusLabels[selectedCase.status]}
                  </span>
                </div>
                {mode === 'platform' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(['in_review', 'awaiting_business', 'resolved', 'closed'] as const).map(status => (
                      <Button
                        key={status}
                        size="sm"
                        variant={selectedCase.status === status ? 'default' : 'outline'}
                        onClick={() => void changeStatus(status)}
                        className="rounded-lg"
                      >
                        {status === 'in_review'
                          ? 'En revisión'
                          : status === 'awaiting_business'
                            ? 'Pedir información'
                            : status === 'resolved'
                              ? 'Resolver y reactivar'
                              : 'Cerrar caso'}
                      </Button>
                    ))}
                  </div>
                )}
              </header>
              <div className="flex-1 space-y-3 overflow-y-auto bg-muted/15 p-4">
                {loadingMessages ? (
                  <p className="text-sm text-muted-foreground">Cargando mensajes…</p>
                ) : messages.length ? (
                  messages.map(message => {
                    const isAdmin = message.senderRole === 'superadmin';
                    const mine = mode === 'platform' ? isAdmin : !isAdmin;
                    return (
                      <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[88%] rounded-2xl px-4 py-3 ${mine ? 'bg-[var(--brand-primary)] text-white' : 'border border-border bg-card'}`}
                        >
                          <p
                            className={`mb-1 text-[11px] font-semibold ${mine ? 'text-white/75' : 'text-muted-foreground'}`}
                          >
                            {message.senderName} · {timeLabel(message.createdAt)}
                          </p>
                          <p className="whitespace-pre-wrap break-words text-sm">{message.message}</p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex h-full min-h-32 flex-col items-center justify-center text-center text-muted-foreground">
                    <MessageCircle size={28} className="mb-2 opacity-50" />
                    <p className="text-sm">Aún no hay mensajes</p>
                    <p className="mt-1 text-xs">Utiliza este espacio para dar seguimiento al caso.</p>
                  </div>
                )}
              </div>
              <form onSubmit={send} className="border-t border-border p-3">
                <div className="flex items-end gap-2">
                  <Textarea
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    maxLength={4000}
                    rows={2}
                    placeholder="Escribe una respuesta clara y respetuosa…"
                    className="min-h-12 resize-y rounded-xl"
                  />
                  <Button
                    type="submit"
                    disabled={!draft.trim() || sending}
                    className="h-11 rounded-xl bg-[var(--brand-primary)] text-white hover:opacity-90"
                  >
                    <Send size={16} className="mr-2" />
                    {sending ? 'Enviando' : 'Enviar'}
                  </Button>
                </div>
                <p className="mt-1 text-right text-[11px] text-muted-foreground">{draft.length}/4000 caracteres</p>
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <ShieldCheck size={32} className="mb-3 opacity-40" />
              <h3 className="font-semibold text-foreground">
                {mode === 'platform' ? 'Selecciona un caso' : 'No hay una conversación abierta'}
              </h3>
              <p className="mt-1 max-w-sm text-sm">
                {mode === 'platform'
                  ? 'Elige un negocio en la lista para revisar el historial y responder.'
                  : 'Si tu negocio es suspendido, aquí podrás comunicarte con el equipo de soporte.'}
              </p>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}
