import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore, useToast } from '../../app/providers';
import { ErrorState, Loader, TopBar } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { adminApi, api, ApiError } from '../../lib/api';
import { assetUrl } from '../../lib/asset';
import { conditionLabel } from '../../lib/format';
import type { Category, Condition, ProductStatus } from '../../types';

const CONDITIONS: Condition[] = ['new_with_tag', 'new_no_tag', 'excellent', 'good', 'has_issues'];

export function ProductEditor() {
  const { id } = useParams();
  const isNew = !id;
  const { store } = useStore();
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [cats, setCats] = useState<Category[]>([]);
  const [form, setForm] = useState({
    title: '', categoryId: '', price: '', oldPrice: '', condition: 'good' as Condition,
    brand: '', size: '', color: '', description: '', defects: '', sellerSku: '',
  });
  const [images, setImages] = useState<string[]>([]);
  const [variants, setVariants] = useState<{ size: string; stock: number }[]>([{ size: 'Единый размер', stock: 1 }]);
  const [status, setStatus] = useState<ProductStatus>('draft');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([adminApi.categories(store!.id), isNew ? Promise.resolve(null) : adminApi.product(store!.id, id!)])
      .then(([categories, product]) => {
        if (!active) return;
        setCats(categories.categories);
        if (!product) return;
        const p = product.product;
        setForm({
          title: p.title, categoryId: p.categoryId ?? '', price: String(p.price), oldPrice: p.oldPrice ? String(p.oldPrice) : '',
          condition: p.condition, brand: p.brand ?? '', size: p.size ?? '', color: p.color ?? '', description: p.description ?? '', defects: p.defects ?? '', sellerSku: p.sellerSku ?? '',
        });
        setImages(p.images.map((i) => i.url));
        setVariants(p.variants.map((v) => ({ size: v.size, stock: v.stock })));
        setStatus(p.status);
      })
      .catch((e) => { if (active) setError(e instanceof ApiError ? e.message : 'Не удалось загрузить товар'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [store?.id, id, reloadKey]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const urls = await api.upload(files);
      setImages((prev) => [...prev, ...urls].slice(0, 10));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка загрузки');
    } finally {
      setUploading(false);
    }
  }

  function body(publish: boolean) {
    return {
      title: form.title.trim(),
      categoryId: form.categoryId || null,
      price: Number(form.price) || 0,
      oldPrice: form.oldPrice ? Number(form.oldPrice) : null,
      condition: form.condition,
      brand: form.brand.trim() || null,
      size: form.size.trim() || null,
      variants: variants.map((v) => ({ size: v.size.trim(), stock: v.stock })),
      color: form.color.trim() || null,
      description: form.description.trim() || null,
      defects: form.defects.trim() || null,
      sellerSku: form.sellerSku.trim() || null,
      images,
      publish,
    };
  }

  async function save(publish: boolean) {
    setSaving(true);
    try {
      if (isNew) await adminApi.createProduct(store!.id, body(publish));
      else await adminApi.updateProduct(store!.id, id!, body(publish));
      toast(publish ? 'Опубликовано' : 'Сохранено');
      nav('/admin/products');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="page"><Loader /></div>;
  if (error) return <div className="page"><TopBar title="Товар" fallback="/admin/products" /><ErrorState message={error} onRetry={() => setReloadKey((n) => n + 1)} /></div>;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="page" style={{ paddingBottom: 96 }}>
      <TopBar title={isNew ? 'Новый товар' : 'Редактирование'} fallback="/admin/products" />

      <div className="field">
        <label>Фотографии (1–10)</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {images.map((url, i) => (
            <div key={url} style={{ position: 'relative' }}>
              <img src={assetUrl(url)} alt="" style={{ width: 72, height: 90, objectFit: 'cover', borderRadius: 10 }} />
              <button className="iconbtn remove-image" aria-label={`Удалить фото ${i + 1}`} onClick={() => setImages((p) => p.filter((_, idx) => idx !== i))}><Icon name="close" size={18} /></button>
            </div>
          ))}
          <button className="card" aria-label="Добавить фото товара" style={{ width: 72, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--border)', color: 'var(--tg-text)' }} onClick={() => fileRef.current?.click()} disabled={uploading || images.length >= 10}>
            {uploading ? '…' : <Icon name="add" size={22} />}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      </div>

      <div className="field"><label>Название *</label><input aria-label="Название товара" value={form.title} onChange={set('title')} maxLength={120} placeholder="от 3 до 120 символов" /></div>

      <div className="field">
        <label>Категория *</label>
        <div className="select-wrap">
          <select aria-label="Категория" value={form.categoryId} onChange={set('categoryId')}>
            <option value="">— выбрать —</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.parentId ? `${cats.find((parent) => parent.id === c.parentId)?.name ?? 'Подкатегория'} / ${c.name}` : c.name}</option>)}
          </select>
          <Icon name="chevronDown" size={18} />
        </div>
      </div>

      <div className="row">
        <div className="field"><label>Цена, ₽ *</label><input aria-label="Цена" value={form.price} onChange={set('price')} inputMode="numeric" /></div>
        <div className="field"><label>Старая цена, ₽</label><input aria-label="Старая цена" value={form.oldPrice} onChange={set('oldPrice')} inputMode="numeric" /></div>
      </div>

      <div className="field">
        <label>Состояние *</label>
        <div className="select-wrap">
          <select aria-label="Состояние" value={form.condition} onChange={set('condition')}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{conditionLabel[c]}</option>)}
          </select>
          <Icon name="chevronDown" size={18} />
        </div>
      </div>

      <div className="row">
        <div className="field"><label>Бренд</label><input aria-label="Бренд" value={form.brand} onChange={set('brand')} /></div>
        <div className="field"><label>Размеры и количество</label><p className="small muted">Укажите общее количество каждого размера, включая уже проданное и забронированное. Эти единицы нельзя убрать из истории заказов.</p>
          {variants.map((v, index) => <div className="variant-editor-row" key={index}>
            <input aria-label={`Размер ${index + 1}`} value={v.size} maxLength={40} onChange={(e) => setVariants((list) => list.map((item, n) => n === index ? { ...item, size: e.target.value } : item))} placeholder="Например, M" />
            <input aria-label={`Количество размера ${index + 1}`} type="number" inputMode="numeric" min={0} max={10000} value={v.stock} onChange={(e) => setVariants((list) => list.map((item, n) => n === index ? { ...item, stock: Math.max(0, Number(e.target.value) || 0) } : item))} />
            <button type="button" className="iconbtn" aria-label={`Удалить размер ${index + 1}`} disabled={variants.length === 1} onClick={() => setVariants((list) => list.filter((_, n) => n !== index))}><Icon name="close" size={18} /></button>
          </div>)}
          {variants.length < 30 && <button type="button" className="btn small outline" onClick={() => setVariants((list) => [...list, { size: '', stock: 1 }])}>Добавить размер</button>}
        </div>
      </div>
      <div className="row">
        <div className="field"><label>Цвет</label><input aria-label="Цвет" value={form.color} onChange={set('color')} /></div>
        <div className="field"><label>Артикул</label><input aria-label="Артикул" value={form.sellerSku} onChange={set('sellerSku')} /></div>
      </div>

      <div className="field"><label>Описание</label><textarea aria-label="Описание товара" value={form.description} onChange={set('description')} maxLength={4000} /></div>
      <div className="field"><label>Дефекты</label><textarea aria-label="Дефекты" value={form.defects} onChange={set('defects')} maxLength={1000} /></div>

      <div className="bar">
        {(isNew || status === 'draft') && <button className="btn outline" onClick={() => save(false)} disabled={saving}>{isNew ? 'Черновик' : 'Сохранить черновик'}</button>}
        <button className="btn" onClick={() => save(isNew || status === 'draft')} disabled={saving}>{isNew || status === 'draft' ? 'Опубликовать' : 'Сохранить изменения'}</button>
      </div>
    </div>
  );
}
