import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../app/providers';
import { Empty, ErrorState, Loader, TopBar } from '../components/ui';
import { Icon } from '../components/Icon';
import { api, adminApi, ApiError } from '../lib/api';
import { assetUrl } from '../lib/asset';
import type { ChatMessage, ChatPage, ChatThreadSummary } from '../types';

type ChatProps = {
  title: string;
  fallback: string;
  load: (before?: string) => Promise<ChatPage>;
  send: (text: string, media?: { mediaUrl: string; mediaType: 'image' | 'video' }, productId?: string) => Promise<unknown>;
  productId?: string;
  seller?: boolean;
  emptyHint?: string;
};

function Conversation({ title, fallback, load, send, productId, seller = false, emptyHint = 'Напишите здесь — продавец ответит в приложении.' }: ChatProps) {
  const [items, setItems] = useState<ChatMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachment, setAttachment] = useState<{ mediaUrl: string; mediaType: 'image' | 'video' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [olderLoading, setOlderLoading] = useState(false);
  const [productTitle, setProductTitle] = useState<string | null>(null);
  const [participantName, setParticipantName] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);
  const latestBuyerMessage = seller ? [...items].reverse().find((message) => !message.mine) : null;

  const refresh = useCallback(async (forceBottom = false) => {
    const box = scrollRef.current;
    const atBottom = forceBottom || firstLoad.current || !box || box.scrollHeight - box.scrollTop - box.clientHeight < 100;
    try {
      const page = await load();
      if (page.participantName) setParticipantName(page.participantName);
      setItems((prev) => {
        const merged = new Map(prev.map((item) => [item.id, item]));
        page.items.forEach((item) => merged.set(item.id, item));
        return [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      });
      if (firstLoad.current) setCursor(page.nextCursor);
      setError(null);
      firstLoad.current = false;
      if (atBottom) requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
    } catch (e) {
      if (firstLoad.current) setError(e instanceof ApiError ? e.message : 'Не удалось открыть чат');
    } finally { setLoading(false); }
  }, [load]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setLoading(true);
    setParticipantName(null);
    firstLoad.current = true;
    refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!productId) { setProductTitle(null); return; }
    let active = true;
    api.product(productId).then((r) => { if (active) setProductTitle(r.product.title); }).catch(() => { if (active) setProductTitle(null); });
    return () => { active = false; };
  }, [productId]);

  async function loadOlder() {
    if (!cursor || olderLoading) return;
    const box = scrollRef.current;
    const height = box?.scrollHeight ?? 0;
    setOlderLoading(true);
    try {
      const page = await load(cursor);
      setItems((prev) => [...page.items, ...prev]);
      setCursor(page.nextCursor);
      requestAnimationFrame(() => { if (box) box.scrollTop += box.scrollHeight - height; });
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Не удалось загрузить историю'); }
    finally { setOlderLoading(false); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if ((!value && !attachment) || sending || uploading) return;
    setSending(true);
    try {
      await send(value, attachment ?? undefined, seller ? latestBuyerMessage?.product?.id : undefined);
      setText('');
      setAttachment(null);
      await refresh(true);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Сообщение не отправлено'); }
    finally { setSending(false); }
  }

  async function attach(file?: File) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      if (file.type.startsWith('image/') || ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) {
        if (file.size > 20 * 1024 * 1024) throw new Error('Видео должно быть не больше 20 МБ');
        setAttachment(await api.uploadChatMedia(file));
      } else throw new Error('Поддерживаются фото и видео MP4, WebM, MOV');
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось прикрепить файл'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  return (
    <div className="page chat-page">
      <TopBar title={participantName ?? title} fallback={fallback} />
      {productTitle && <div className="chat-context"><Icon name="catalog" size={18} /><span>Вопрос о товаре: <Link to={`/product/${productId}`}>{productTitle}</Link></span></div>}
      {seller && latestBuyerMessage?.product && <div className="chat-context"><Icon name="catalog" size={18} /><span>Последний вопрос: <Link to={`/product/${latestBuyerMessage.product.id}`}>{latestBuyerMessage.product.title}</Link>. Ответ будет связан с этой вещью.</span></div>}
      <div className="chat-messages" ref={scrollRef} aria-live="polite">
        {loading && <Loader text="Открываем переписку…" />}
        {!loading && cursor && <button className="btn small outline chat-older" onClick={loadOlder} disabled={olderLoading}>{olderLoading ? 'Загружаем…' : 'Ранние сообщения'}</button>}
        {!loading && items.length === 0 && !error && <Empty icon="chat" title="Пока нет сообщений" hint={emptyHint} />}
        {items.map((message) => (
          <div key={message.id} className={`chat-message ${message.mine ? 'mine' : ''}`}>
            {message.product && <Link className="chat-product" to={`/product/${message.product.id}`}>{message.product.title}</Link>}
            {message.mediaUrl && message.mediaType && <ChatAttachment message={message} />}
            {message.text && <span>{message.text}</span>}
            <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
        ))}
      </div>
      {error && <ErrorState message={error} onRetry={() => refresh()} />}
      <form className="chat-composer" onSubmit={submit}>
        {attachment && <div className="chat-attachment"><span>{attachment.mediaType === 'image' ? 'Фото прикреплено' : 'Видео прикреплено'}</span><button type="button" onClick={() => setAttachment(null)} aria-label="Убрать вложение"><Icon name="close" size={16} /></button></div>}
        <div className="chat-composer-row">
          <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" hidden onChange={(e) => attach(e.target.files?.[0])} />
          <button className="iconbtn chat-attach" type="button" onClick={() => fileRef.current?.click()} aria-label="Прикрепить фото или видео" disabled={sending || uploading}><Icon name="attach" size={20} /></button>
          <input aria-label={productId ? 'Сообщение продавцу' : 'Текст сообщения'} placeholder={uploading ? 'Загружаем файл…' : 'Написать сообщение'} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          <button className="btn" type="submit" aria-label="Отправить сообщение" disabled={(!text.trim() && !attachment) || sending || uploading}><Icon name="send" size={20} /></button>
        </div>
      </form>
    </div>
  );
}

function ChatAttachment({ message }: { message: ChatMessage }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    api.chatMedia(message.id).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [message.id]);
  if (!url) return <span className="small muted">Вложение загружается или недоступно</span>;
  return message.mediaType === 'image'
    ? <img className="chat-media" src={url} alt="Фото в сообщении" />
    : <video className="chat-media" src={url} controls playsInline preload="metadata" aria-label="Видео в сообщении" />;
}

export function BuyerChat() {
  const { store } = useStore();
  const [params] = useSearchParams();
  const productId = params.get('product') ?? undefined;
  const load = useCallback((before?: string) => api.chat(before), []);
  const send = useCallback((text: string, media?: { mediaUrl: string; mediaType: 'image' | 'video' }) => api.sendChat(text, productId, media), [productId]);
  return <Conversation key={productId ?? 'general'} title={store?.name ?? 'Продавец'} fallback={productId ? `/product/${productId}` : '/'} load={load} send={send} productId={productId} />;
}

export function AdminChats() {
  const { store } = useStore();
  const [items, setItems] = useState<ChatThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (!store) return;
    adminApi.chats(store.id).then((r) => { setItems(r.items); setError(null); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Не удалось загрузить чаты'))
      .finally(() => setLoading(false));
  }, [store]);
  useEffect(() => { reload(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 5000); return () => window.clearInterval(timer); }, [reload]);

  return <div className="page">
    <h1 style={{ marginBottom: 14 }}>Чаты с покупателями</h1>
    {loading && <Loader />}
    {error && <ErrorState message={error} onRetry={reload} />}
    {!loading && !error && items.length === 0 && <Empty icon="chat" title="Сообщений пока нет" hint="Когда покупатель напишет, диалог появится здесь." />}
    <div className="list">
      {items.map(({ buyer, preview, updatedAt, product }) => <Link className="card chat-thread" key={buyer.id} to={`/admin/chats/${buyer.id}`}>
        {buyer.avatarUrl ? <img className="avatar sm" src={assetUrl(buyer.avatarUrl)} alt="" /> : <span className="avatar sm chat-avatar"><Icon name="profile" size={19} /></span>}
        <span className="grow"><strong>{[buyer.firstName, buyer.lastName].filter(Boolean).join(' ') || (buyer.username ? `@${buyer.username}` : 'Покупатель')}</strong>{product && <small className="chat-thread-product">По товару: {product.title}</small>}<small>{preview}</small></span>
        <time>{new Date(updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</time>
      </Link>)}
    </div>
  </div>;
}

export function AdminChatThread() {
  const { store } = useStore();
  const { buyerId } = useParams();
  const load = useCallback((before?: string) => adminApi.chat(store!.id, buyerId!, before), [store?.id, buyerId]);
  const send = useCallback((text: string, media?: { mediaUrl: string; mediaType: 'image' | 'video' }, productId?: string) => adminApi.sendChat(store!.id, buyerId!, text, media, productId), [store?.id, buyerId]);
  return <Conversation key={buyerId} title="Переписка" fallback="/admin/chats" load={load} send={send} seller emptyHint="Напишите покупателю по его заявке." />;
}
