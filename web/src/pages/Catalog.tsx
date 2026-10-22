import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ProductCard } from '../components/ProductCard';
import { Icon } from '../components/Icon';
import { Empty, ErrorState, Loader } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { conditionLabel } from '../lib/format';
import { getStoreSlug } from '../lib/telegram';
import type { Condition, Product } from '../types';
import { useStore } from '../app/providers';

interface FilterState {
  q: string;
  sort: string;
  category?: string;
  subcategory?: string;
  brand: string[];
  size: string[];
  color: string[];
  condition: string[];
  priceFrom?: number;
  priceTo?: number;
  discounted?: boolean;
  availableOnly?: boolean;
}

const EMPTY: FilterState = { q: '', sort: 'new', brand: [], size: [], color: [], condition: [] };
const SORTS = [
  { v: 'new', l: 'Сначала новые' },
  { v: 'price_asc', l: 'Дешевле' },
  { v: 'price_desc', l: 'Дороже' },
  { v: 'discount', l: 'Со скидкой' },
  { v: 'popular', l: 'Популярные' },
];
const STORAGE_KEY = () => `catalog_filters_${getStoreSlug()}`;

function toggle(arr: string[], v: string): string[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function Catalog() {
  const { store } = useStore();
  const [params] = useSearchParams();
  // фильтры сохраняются при возврате из карточки (§6.4): URL → sessionStorage → пусто
  const [filters, setFilters] = useState<FilterState>(() => {
    const fromUrl: Partial<FilterState> = {};
    if (params.get('q')) fromUrl.q = params.get('q')!;
    if (params.get('category')) fromUrl.category = params.get('category')!;
    if (SORTS.some((s) => s.v === params.get('sort'))) fromUrl.sort = params.get('sort')!;
    if (params.get('discounted')) fromUrl.discounted = true;
    if (Object.keys(fromUrl).length) return { ...EMPTY, ...fromUrl };
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY());
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return {
          ...EMPTY, ...parsed,
          q: typeof parsed.q === 'string' ? parsed.q : '',
          sort: SORTS.some((s) => s.v === parsed.sort) ? parsed.sort : 'new',
          brand: Array.isArray(parsed.brand) ? parsed.brand : [],
          size: Array.isArray(parsed.size) ? parsed.size : [],
          color: Array.isArray(parsed.color) ? parsed.color : [],
          condition: Array.isArray(parsed.condition) ? parsed.condition : [],
        };
      }
    } catch { /* ignore */ }
    return EMPTY;
  });
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    if (!sheet) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheet(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [sheet]);
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const availableFilters = useAsync(() => api.filters(), []);

  // debounce поиска, чтобы не слать запрос на каждую букву (§6.3)
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  const qTimer = useRef<number>();
  useEffect(() => {
    window.clearTimeout(qTimer.current);
    qTimer.current = window.setTimeout(() => setDebouncedQ(filters.q), 350);
    return () => window.clearTimeout(qTimer.current);
  }, [filters.q]);

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY(), JSON.stringify(filters)); } catch { /* ignore */ }
  }, [filters]);

  const query = useMemo(
    () => ({
      q: debouncedQ.length >= 2 ? debouncedQ : undefined,
      sort: filters.sort,
      category: filters.category,
      subcategory: filters.subcategory,
      brand: filters.brand,
      size: filters.size,
      color: filters.color,
      condition: filters.condition,
      priceFrom: filters.priceFrom,
      priceTo: filters.priceTo,
      discounted: filters.discounted ? 1 : undefined,
      availableOnly: filters.availableOnly ? 1 : undefined,
    }),
    [debouncedQ, filters],
  );

  // сброс на 1 страницу при смене условий
  useEffect(() => { setPage(1); }, [query]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    if (page === 1) {
      setItems([]);
      setTotal(0);
      setHasMore(false);
    }
    api
      .catalog({ ...query, page })
      .then((r) => {
        if (!active) return;
        setItems((prev) => (page === 1 ? r.items : [...prev, ...r.items]));
        setTotal(r.total);
        setHasMore(r.hasMore);
      })
      .catch((e) => active && setError(e instanceof ApiError ? e.message : 'Ошибка'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [query, page, retryKey]);

  const af = availableFilters.data;
  const activeCount =
    (filters.category ? 1 : 0) + filters.brand.length + filters.size.length + filters.color.length +
    filters.condition.length + (filters.priceFrom ? 1 : 0) + (filters.priceTo ? 1 : 0) +
    (filters.discounted ? 1 : 0) + (filters.availableOnly ? 1 : 0);

  return (
    <div className="page">
      <div className="searchbar">
        <span className="ico"><Icon name="search" /></span>
        <input
          aria-label="Поиск по названию и бренду"
          placeholder="Поиск: название, бренд…"
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        />
      </div>

      <div className="chips wrap-chips" style={{ marginBottom: 10 }}>
        <button className="chip active" onClick={() => setSheet(true)} disabled={!af}><Icon name="filters" size={17} />Фильтры{activeCount ? ` · ${activeCount}` : ''}</button>
        {SORTS.map((s) => (
          <button key={s.v} className={`chip ${filters.sort === s.v ? 'active' : ''}`} onClick={() => setFilters((f) => ({ ...f, sort: s.v }))}>
            {s.l}
          </button>
        ))}
      </div>

      {availableFilters.error && <ErrorState message={`Не удалось загрузить фильтры: ${availableFilters.error}`} onRetry={availableFilters.reload} />}

      <div className="small muted" style={{ marginBottom: 10 }}>Найдено: {total}</div>

      {error && !items.length ? (
        <ErrorState message={error} onRetry={() => setRetryKey((n) => n + 1)} />
      ) : items.length === 0 && !loading ? (
        <Empty icon="search" title={filters.category ? 'В этой категории пока нет товаров' : 'Ничего не найдено'} hint="Попробуйте изменить или сбросить фильтры" action={<button className="btn small" onClick={() => setFilters(EMPTY)}>Сбросить фильтры</button>} />
      ) : (
        <>
          <div className="grid">
            {items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          {loading && <Loader />}
          {error && <ErrorState message={error} onRetry={() => setRetryKey((n) => n + 1)} />}
          {hasMore && !loading && (
            <button className="btn secondary" style={{ marginTop: 16 }} onClick={() => setPage((p) => p + 1)}>
              Показать ещё
            </button>
          )}
        </>
      )}

      {sheet && af && (
        <div className="sheet-backdrop" onClick={() => setSheet(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="catalog-filter-title" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><h2 id="catalog-filter-title">Фильтры</h2><button className="iconbtn" aria-label="Закрыть фильтры" onClick={() => setSheet(false)} autoFocus><Icon name="close" size={20} /></button></div>

            {af.categories.length > 0 && (
              <FilterGroup title="Категория">
                <div className="chips" style={{ flexWrap: 'wrap' }}>
                  {af.categories.filter((c) => !c.parentId).map((c) => (
                    <button key={c.id} className={`chip ${filters.category === c.id ? 'active' : ''}`}
                      onClick={() => setFilters((f) => ({ ...f, category: f.category === c.id ? undefined : c.id }))}>
                      {c.name}
                    </button>
                  ))}
                </div>
              </FilterGroup>
            )}

            {af.brands.length > 0 && (
              <FilterGroup title="Бренд">
                <ChipMulti values={af.brands} selected={filters.brand} onToggle={(v) => setFilters((f) => ({ ...f, brand: toggle(f.brand, v) }))} />
              </FilterGroup>
            )}
            {af.sizes.length > 0 && (
              <FilterGroup title="Размер">
                <ChipMulti values={af.sizes} selected={filters.size} onToggle={(v) => setFilters((f) => ({ ...f, size: toggle(f.size, v) }))} />
              </FilterGroup>
            )}
            {af.conditions.length > 0 && (
              <FilterGroup title="Состояние">
                <ChipMulti values={af.conditions} labels={(v) => conditionLabel[v as Condition]} selected={filters.condition} onToggle={(v) => setFilters((f) => ({ ...f, condition: toggle(f.condition, v) }))} />
              </FilterGroup>
            )}
            {af.colors.length > 0 && (
              <FilterGroup title="Цвет">
                <ChipMulti values={af.colors} selected={filters.color} onToggle={(v) => setFilters((f) => ({ ...f, color: toggle(f.color, v) }))} />
              </FilterGroup>
            )}

            <FilterGroup title={`Цена, ${store?.settings.currency ?? 'RUB'}`}>
              <div className="row">
                <input aria-label="Цена от" type="number" inputMode="numeric" placeholder={`от ${af.priceMin}`} value={filters.priceFrom ?? ''} onChange={(e) => setFilters((f) => ({ ...f, priceFrom: e.target.value ? Number(e.target.value) : undefined }))} />
                <input aria-label="Цена до" type="number" inputMode="numeric" placeholder={`до ${af.priceMax}`} value={filters.priceTo ?? ''} onChange={(e) => setFilters((f) => ({ ...f, priceTo: e.target.value ? Number(e.target.value) : undefined }))} />
              </div>
            </FilterGroup>

            <label className="checkbox" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={!!filters.discounted} onChange={(e) => setFilters((f) => ({ ...f, discounted: e.target.checked }))} />
              <span>Только со скидкой</span>
            </label>
            <label className="checkbox" style={{ marginBottom: 16 }}>
              <input type="checkbox" checked={!!filters.availableOnly} onChange={(e) => setFilters((f) => ({ ...f, availableOnly: e.target.checked }))} />
              <span>Только доступные</span>
            </label>

            <div className="row">
              <button className="btn outline" onClick={() => setFilters({ ...EMPTY, sort: filters.sort })}>Сбросить</button>
              <button className="btn" onClick={() => setSheet(false)}>Показать товары</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="small muted" style={{ marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function ChipMulti({ values, selected, onToggle, labels }: { values: string[]; selected: string[]; onToggle: (v: string) => void; labels?: (v: string) => string }) {
  return (
    <div className="chips" style={{ flexWrap: 'wrap' }}>
      {values.map((v) => (
        <button key={v} className={`chip ${selected.includes(v) ? 'active' : ''}`} onClick={() => onToggle(v)}>
          {labels ? labels(v) : v}
        </button>
      ))}
    </div>
  );
}
