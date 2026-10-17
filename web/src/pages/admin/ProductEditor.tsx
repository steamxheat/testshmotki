import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore, useToast } from '../../app/providers';
import { Loader, TopBar } from '../../components/ui';
import { adminApi, api, ApiError } from '../../lib/api';
import { conditionLabel } from '../../lib/format';
import type { Category, Condition } from '../../types';

const CONDITIONS: Condition[] = ['new_with_tag', 'new_no_tag', 'excellent', 'good', 'has_issues'];

export function ProductEditor() {
  const { id } = useParams();
  const isNew = !id;
  const { store } = useStore();
  const toast = useToast();
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(!isNew);
  const [cats, setCats] = useState<Category[]>([]);
  const [form, setForm] = useState({
    title: '', categoryId: '', price: '', oldPrice: '', condition: 'good' as Condition,
    brand: '', size: '', color: '', description: '', defects: '', sellerSku: '',
  });
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminApi.categories(store!.id).then((r) => setCats(r.categories));
    if (!isNew) {
      adminApi.product(store!.id, id!).then((r) => {
        const p = r.product;
        setForm({
          title: p.title, categoryId: p.categoryId ?? '', price: String(p.price), oldPrice: p.oldPrice ? String(p.oldPrice) : '',
          condition: p.condition, brand: p.brand ?? '', size: p.size ?? '', color: p.color ?? '', description: p.description ?? '', defects: p.defects ?? '', sellerSku: p.sellerSku ?? '',
        });
        setImages(p.images.map((i) => i.url));
      }).finally(() => setLoading(false));
    }
  }, [store?.id, id]);

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

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="page" style={{ paddingBottom: 96 }}>
      <TopBar title={isNew ? 'Новый товар' : 'Редактирование'} />

      <div className="field">
        <label>Фотографии (1–10)</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {images.map((url, i) => (
            <div key={url} style={{ position: 'relative' }}>
              <img src={url} alt="" style={{ width: 72, height: 90, objectFit: 'cover', borderRadius: 10 }} />
              <button className="iconbtn" style={{ position: 'absolute', top: -6, right: -6, minWidth: 24, minHeight: 24, background: '#e5484d' }} onClick={() => setImages((p) => p.filter((_, idx) => idx !== i))}>×</button>
            </div>
          ))}
          <button className="card" style={{ width: 72, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, border: '1px dashed var(--border)' }} onClick={() => fileRef.current?.click()} disabled={images.length >= 10}>
            {uploading ? '…' : '+'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      </div>

      <div className="field"><label>Название *</label><input value={form.title} onChange={set('title')} maxLength={120} placeholder="от 3 до 120 символов" /></div>

      <div className="field">
        <label>Категория *</label>
        <select value={form.categoryId} onChange={set('categoryId')}>
          <option value="">— выбрать —</option>
          {cats.filter((c) => !c.parentId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="row">
        <div className="field"><label>Цена, ₽ *</label><input value={form.price} onChange={set('price')} inputMode="numeric" /></div>
        <div className="field"><label>Старая цена, ₽</label><input value={form.oldPrice} onChange={set('oldPrice')} inputMode="numeric" /></div>
      </div>

      <div className="field">
        <label>Состояние *</label>
        <select value={form.condition} onChange={set('condition')}>
          {CONDITIONS.map((c) => <option key={c} value={c}>{conditionLabel[c]}</option>)}
        </select>
      </div>

      <div className="row">
        <div className="field"><label>Бренд</label><input value={form.brand} onChange={set('brand')} /></div>
        <div className="field"><label>Размер</label><input value={form.size} onChange={set('size')} /></div>
      </div>
      <div className="row">
        <div className="field"><label>Цвет</label><input value={form.color} onChange={set('color')} /></div>
        <div className="field"><label>Артикул</label><input value={form.sellerSku} onChange={set('sellerSku')} /></div>
      </div>

      <div className="field"><label>Описание</label><textarea value={form.description} onChange={set('description')} maxLength={4000} /></div>
      <div className="field"><label>Дефекты</label><textarea value={form.defects} onChange={set('defects')} maxLength={1000} /></div>

      <div className="bar">
        <button className="btn outline" onClick={() => save(false)} disabled={saving}>Черновик</button>
        <button className="btn" onClick={() => save(true)} disabled={saving}>Опубликовать</button>
      </div>
    </div>
  );
}
