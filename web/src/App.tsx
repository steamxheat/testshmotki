import { useEffect, useState } from 'react';
import { Link, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from './app/providers';
import { BottomNav } from './components/BottomNav';
import { Empty, ErrorState, Loader } from './components/ui';

import { Home } from './pages/Home';
import { Catalog } from './pages/Catalog';
import { Favorites } from './pages/Favorites';
import { Orders } from './pages/Orders';
import { Profile } from './pages/Profile';
import { Reviews } from './pages/Reviews';
import { ProductPage } from './pages/Product';
import { Checkout } from './pages/Checkout';
import { Cart } from './pages/Cart';
import { BuyerChat, AdminChats, AdminChatThread } from './pages/Chat';

import { AdminLayout } from './pages/admin/AdminLayout';
import { Overview } from './pages/admin/Overview';
import { AdminProducts } from './pages/admin/Products';
import { ProductEditor } from './pages/admin/ProductEditor';
import { AdminOrders } from './pages/admin/Orders';
import { AdminReviews } from './pages/admin/Reviews';
import { AdminCategories } from './pages/admin/Categories';
import { Settings } from './pages/admin/Settings';
import { DeliveryGuide } from './pages/admin/DeliveryGuide';
import { Legal } from './pages/Legal';
import { LegalNotice } from './components/LegalNotice';
import { api } from './lib/api';

function BuyerLayout() {
  return (
    <>
      <Outlet />
      <BottomNav />
    </>
  );
}

export function App() {
  const { loading, error, blocked, store, reloadStore } = useStore();
  const location = useLocation();
  const [noticeDecision, setNoticeDecision] = useState<'accepted' | 'dismissed' | null | undefined>(undefined);
  const [noticeError, setNoticeError] = useState(false);

  useEffect(() => {
    if (!store) return;
    let active = true;
    setNoticeDecision(undefined);
    api.legalNotice().then((r) => { if (active) { setNoticeDecision(r.decision); setNoticeError(false); } })
      .catch(() => { if (active) setNoticeError(true); });
    return () => { active = false; };
  }, [store?.id, store?.settings.legalName, store?.settings.legalInn, store?.settings.legalAddress, store?.settings.legalEmail]);

  if (loading) return <div className="app"><Loader text="Открываем магазин…" /></div>;
  if (blocked)
    return (
      <div className="app">
        <Empty icon="lock" title="Магазин недоступен" hint="Продавец временно закрыл витрину. Загляните позже." />
      </div>
    );
  if (error && !store)
    return (
      <div className="app">
        <ErrorState message={error} onRetry={reloadStore} />
      </div>
    );
  if (!location.pathname.startsWith('/legal/')) {
    if (noticeError) return <div className="app"><div className="page"><ErrorState message="Не удалось проверить настройки конфиденциальности" onRetry={() => { setNoticeError(false); api.legalNotice().then((r) => setNoticeDecision(r.decision)).catch(() => setNoticeError(true)); }} /></div></div>;
    if (noticeDecision === undefined) return <div className="app"><Loader text="Проверяем документы магазина…" /></div>;
    if (noticeDecision === null) return <div className="app"><LegalNotice onDone={setNoticeDecision} /></div>;
  }

  return (
    <div className="app">
      <Routes>
        <Route element={<BuyerLayout />}>
          <Route index element={<Home />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/chat" element={<BuyerChat />} />
        </Route>

        <Route path="/product/:id" element={<ProductPage />} />
        <Route path="/checkout/:productId" element={<Checkout />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/legal/:document" element={<Legal />} />

        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Overview />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="products/new" element={<ProductEditor />} />
          <Route path="products/:id" element={<ProductEditor />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="chats" element={<AdminChats />} />
          <Route path="chats/:buyerId" element={<AdminChatThread />} />
          <Route path="reviews" element={<AdminReviews />} />
          <Route path="categories" element={<AdminCategories />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/delivery/:method" element={<DeliveryGuide />} />
        </Route>

        <Route path="*" element={<Empty icon="compass" title="Страница не найдена" />} />
      </Routes>
    </div>
  );
}
