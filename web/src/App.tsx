import { Outlet, Route, Routes } from 'react-router-dom';
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

import { AdminLayout } from './pages/admin/AdminLayout';
import { Overview } from './pages/admin/Overview';
import { AdminProducts } from './pages/admin/Products';
import { ProductEditor } from './pages/admin/ProductEditor';
import { AdminOrders } from './pages/admin/Orders';
import { AdminReviews } from './pages/admin/Reviews';
import { AdminCategories } from './pages/admin/Categories';
import { Settings } from './pages/admin/Settings';
import { Superadmin } from './pages/admin/Superadmin';

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

  if (loading) return <div className="app"><Loader text="Открываем магазин…" /></div>;
  if (blocked)
    return (
      <div className="app">
        <Empty icon="🔒" title="Магазин недоступен" hint="Продавец временно закрыл витрину. Загляните позже." />
      </div>
    );
  if (error && !store)
    return (
      <div className="app">
        <ErrorState message={error} onRetry={reloadStore} />
      </div>
    );

  return (
    <div className="app">
      <Routes>
        <Route element={<BuyerLayout />}>
          <Route index element={<Home />} />
          <Route path="/catalog" element={<Catalog />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/reviews" element={<Reviews />} />
        </Route>

        <Route path="/product/:id" element={<ProductPage />} />
        <Route path="/checkout/:productId" element={<Checkout />} />

        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Overview />} />
          <Route path="products" element={<AdminProducts />} />
          <Route path="products/new" element={<ProductEditor />} />
          <Route path="products/:id" element={<ProductEditor />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="reviews" element={<AdminReviews />} />
          <Route path="categories" element={<AdminCategories />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        <Route path="/super" element={<Superadmin />} />

        <Route path="*" element={<Empty icon="🧭" title="Страница не найдена" />} />
      </Routes>
    </div>
  );
}
